import { getChatOrchestrationContext, getCompletedOrchestrationActions } from './chatOrchestrator.js'

export const CHAT_MEMORY_KEY = 'fl_chat_memory'

const MEMORY_VERSION = 1
const MAX_THREAD_MEMORIES = 24
const MAX_WORKSPACE_ITEMS = 8
const MAX_TITLE_LENGTH = 120
const MAX_OBJECTIVE_LENGTH = 240

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeText(value, limit = MAX_TITLE_LENGTH) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function sortRecent(items) {
  return [...items].sort((left, right) => timestamp(right.updated_at || right.created_at) - timestamp(left.updated_at || left.created_at))
}

function cleanProject(project) {
  if (!isRecord(project)) return null
  const id = safeText(project.id, 160)
  const name = safeText(project.name || project.title || project.projectType)
  if (!id || !name) return null
  return Object.freeze({
    id,
    name,
    type: safeText(project.type || project.kind || 'project', 36) || 'project',
    updated_at: typeof project.updated_at === 'string' ? project.updated_at : typeof project.created_at === 'string' ? project.created_at : '',
  })
}

function cleanTask(task) {
  if (!isRecord(task)) return null
  const id = safeText(task.id, 160)
  const title = safeText(task.title || task.name)
  if (!id || !title) return null
  return Object.freeze({
    id,
    title,
    status: safeText(task.status || 'todo', 28) || 'todo',
    updated_at: typeof task.updated_at === 'string' ? task.updated_at : typeof task.created_at === 'string' ? task.created_at : '',
  })
}

function cleanNote(note) {
  if (!isRecord(note)) return null
  const id = safeText(note.id, 160)
  const title = safeText(note.title || note.name)
  if (!id || !title) return null
  return Object.freeze({
    id,
    title,
    updated_at: typeof note.updated_at === 'string' ? note.updated_at : typeof note.created_at === 'string' ? note.created_at : '',
  })
}

/** A bounded workspace index: titles and status only, never note bodies or project files. */
export function buildWorkspaceAwareness({ projects = [], tasks = [], notes = [] } = {}) {
  const cleanItems = (items, cleaner) => sortRecent(Array.isArray(items) ? items.map(cleaner).filter(Boolean) : []).slice(0, MAX_WORKSPACE_ITEMS)
  return Object.freeze({
    projects: Object.freeze(cleanItems(projects, cleanProject)),
    tasks: Object.freeze(cleanItems(tasks, cleanTask)),
    notes: Object.freeze(cleanItems(notes, cleanNote)),
  })
}

const EMPTY_WORKSPACE_AWARENESS = Object.freeze({ projects: Object.freeze([]), tasks: Object.freeze([]), notes: Object.freeze([]) })

function cleanResource(resource) {
  if (!isRecord(resource)) return null
  const type = ['task', 'note', 'project', 'repository', 'branch'].includes(resource.type) ? resource.type : ''
  const id = safeText(resource.id, 160)
  const title = safeText(resource.title)
  if (!type || !id || !title) return null
  return Object.freeze({ type, id, title })
}

function cleanAction(action) {
  if (!isRecord(action) || typeof action.id !== 'string' || typeof action.status !== 'string') return null
  const id = safeText(action.id, 36)
  const status = safeText(action.status, 36)
  if (!id || !status) return null
  const resource = cleanResource(action.resource)
  const at = typeof action.at === 'string' && !Number.isNaN(Date.parse(action.at)) ? action.at.slice(0, 40) : ''
  return Object.freeze({ id, status, ...(resource ? { resource } : {}), ...(at ? { at } : {}) })
}

function cleanThreadMemory(value) {
  if (!isRecord(value)) return null
  const conversationId = safeText(value.conversationId, 160)
  if (!conversationId) return null
  const project = cleanProject(value.project)
  const task = cleanTask(value.task)
  const actions = Array.isArray(value.actions)
    ? value.actions.map(cleanAction).filter(Boolean).slice(-MAX_WORKSPACE_ITEMS)
    : []
  return Object.freeze({
    conversationId,
    title: safeText(value.title) || 'Untitled chat',
    objective: safeText(value.objective, MAX_OBJECTIVE_LENGTH),
    ...(project ? { project } : {}),
    ...(task ? { task } : {}),
    ...(typeof value.mode === 'string' ? { mode: safeText(value.mode, 32) } : {}),
    ...(typeof value.operation === 'string' ? { operation: safeText(value.operation, 32) } : {}),
    ...(['response', 'plan', 'code'].includes(value.artifact) ? { artifact: value.artifact } : {}),
    actions: Object.freeze(actions),
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : '',
  })
}

export function normalizeChatMemory(value) {
  if (!isRecord(value) || value.version !== MEMORY_VERSION || !Array.isArray(value.threads)) {
    return Object.freeze({ value: Object.freeze({ version: MEMORY_VERSION, activeConversationId: '', threads: Object.freeze([]) }), repaired: value !== null && value !== undefined })
  }
  const threads = value.threads.map(cleanThreadMemory).filter(Boolean)
  const activeConversationId = safeText(value.activeConversationId, 160)
  return Object.freeze({
    value: Object.freeze({
      version: MEMORY_VERSION,
      activeConversationId,
      threads: Object.freeze(sortRecent(threads).slice(0, MAX_THREAD_MEMORIES)),
    }),
    repaired: threads.length !== value.threads.length,
  })
}

function tokens(value) {
  return new Set(safeText(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean))
}

function matchesByName(text, item) {
  const titleTokens = tokens(item?.name || item?.title)
  const requestTokens = tokens(text)
  const meaningful = [...titleTokens].filter((token) => token.length > 2)
  return meaningful.length > 0 && meaningful.every((token) => requestTokens.has(token))
}

function latestBuilderProject(workspace) {
  return workspace.projects.find((project) => project.type === 'builder') || null
}

function latestRelevantTask(workspace) {
  return workspace.tasks.find((task) => task.status !== 'done') || workspace.tasks[0] || null
}

function getActionResource(actions, type) {
  return [...actions].reverse().find((action) => action.resource?.type === type)?.resource || null
}

function inferProject({ request, thread, workspace, intent }) {
  const existing = cleanProject(thread?.project)
  const explicit = workspace.projects.find((project) => matchesByName(request, project)) || null
  if (explicit) return explicit
  if (/\bfounderlab\b/i.test(request)) return Object.freeze({ id: 'founderlab', name: 'FounderLab', type: 'product', updated_at: '' })
  if (intent.primaryTool === 'builder' || /\b(?:builder|website|landing page)\b/i.test(request)) {
    return latestBuilderProject(workspace) || existing
  }
  if (/\b(?:this|that|current|the)\s+project\b/i.test(request)) return existing || (workspace.projects.length === 1 ? workspace.projects[0] : null)
  return existing || null
}

function inferTask({ request, thread, workspace }) {
  const resource = getActionResource(thread?.actions || [], 'task')
  if (resource) return cleanTask({ id: resource.id, title: resource.title, status: 'todo' })
  const existing = cleanTask(thread?.task)
  const explicit = workspace.tasks.find((task) => matchesByName(request, task)) || null
  if (explicit) return explicit
  if (/\b(?:this|that|current|the)\s+task\b|\btask from earlier\b/i.test(request)) return existing || latestRelevantTask(workspace)
  return existing || null
}

function threadActions(conversation) {
  return (Array.isArray(conversation?.messages) ? conversation.messages : [])
    .filter((message) => message?.role === 'assistant')
    .flatMap((message) => getCompletedOrchestrationActions(message.orchestration))
    .map(cleanAction)
    .filter(Boolean)
    .slice(-MAX_WORKSPACE_ITEMS)
}

function getLatestAssistantArtifact(conversation) {
  const latestAssistant = [...(Array.isArray(conversation?.messages) ? conversation.messages : [])]
    .reverse()
    .find((message) => message?.role === 'assistant' && safeText(message.content, 1000))
  const content = safeText(latestAssistant?.content, 1000)
  if (!content) return ''
  if (content.includes('```')) return 'code'
  if (/\b(?:plan|milestone|phase|next step|roadmap)\b/i.test(content)) return 'plan'
  return 'response'
}

function buildThreadMemory(conversation, previous, workspace) {
  const context = getChatOrchestrationContext(conversation.messages)
  const request = conversation.messages?.filter((message) => message?.role === 'user').at(-1)?.content || ''
  const actions = threadActions(conversation)
  const artifact = getLatestAssistantArtifact(conversation)
  const previousThread = previous || null
  const objective = context.activeObjective || previousThread?.objective || ''
  const thread = {
    conversationId: conversation.id,
    title: safeText(conversation.title) || 'Untitled chat',
    objective: safeText(objective, MAX_OBJECTIVE_LENGTH),
    ...(context.intent.mode !== 'conversation' ? { mode: context.intent.mode, operation: context.intent.operation } : {}),
    ...(artifact ? { artifact } : {}),
    actions,
    updated_at: conversation.updated_at || conversation.created_at || '',
  }
  const project = inferProject({ request, thread: previousThread, workspace, intent: context.intent })
  const task = inferTask({ request, thread: { ...thread, ...previousThread, actions }, workspace })
  return cleanThreadMemory({ ...thread, ...(project ? { project } : {}), ...(task ? { task } : {}) })
}

/**
 * Reconciles saved, evidence-only memory with the latest persisted chat data.
 * Raw assistant output remains in its conversation; this index only keeps the
 * working context needed to resume a project-aware discussion safely.
 */
export function reconcileChatMemory(memory, conversations = [], workspace = EMPTY_WORKSPACE_AWARENESS, activeConversationId = '') {
  const current = normalizeChatMemory(memory).value
  const previousByConversation = new Map(current.threads.map((thread) => [thread.conversationId, thread]))
  const entries = (Array.isArray(conversations) ? conversations : [])
    .filter((conversation) => isRecord(conversation) && safeText(conversation.id, 160))
    .map((conversation) => buildThreadMemory(conversation, previousByConversation.get(conversation.id), workspace))
    .filter((thread) => thread && (thread.objective || thread.project || thread.task || thread.actions.length))
  return Object.freeze({
    version: MEMORY_VERSION,
    activeConversationId: safeText(activeConversationId, 160),
    threads: Object.freeze(sortRecent(entries).slice(0, MAX_THREAD_MEMORIES)),
  })
}

function hasWorkingContext(thread) {
  return Boolean(thread?.objective || thread?.project || thread?.task || thread?.artifact || thread?.actions?.length)
}

function requestsHistoricalContinuity(value) {
  return /\b(?:continue|earlier|previous|before|we were working|working on|that task|that project|the project|the task)\b/i.test(safeText(value, 500))
}

function getRecentWorkingThread(memory, conversationId, request) {
  const normalized = normalizeChatMemory(memory).value
  const current = normalized.threads.find((thread) => thread.conversationId === conversationId) || null
  if (hasWorkingContext(current)) return { thread: current, scope: 'current-thread' }
  if (!requestsHistoricalContinuity(request)) return { thread: null, scope: '' }
  const active = normalized.threads.find((thread) => thread.conversationId === normalized.activeConversationId && thread.conversationId !== conversationId)
  if (hasWorkingContext(active)) return { thread: active, scope: 'recent-memory' }
  const recent = normalized.threads.find((thread) => thread.conversationId !== conversationId && hasWorkingContext(thread)) || null
  return { thread: recent, scope: recent ? 'recent-memory' : '' }
}

/**
 * A small prompt-ready view of persisted context. It names only verified
 * workspace metadata and explicitly states that those records are not proof
 * of external execution, repository state, or deployment state.
 */
export function getProjectAwareness(memory, workspace = EMPTY_WORKSPACE_AWARENESS, { conversationId = '', request = '', orchestration = null } = {}) {
  const { thread, scope } = getRecentWorkingThread(memory, conversationId, request)
  const intent = orchestration?.intent || getChatOrchestrationContext([]).intent
  const project = inferProject({ request, thread, workspace, intent })
  const task = inferTask({ request, thread, workspace })
  const followUp = orchestration?.reference?.referencesPrevious === true
  return Object.freeze({
    ...(thread?.objective ? { objective: thread.objective } : {}),
    ...(project ? { project } : {}),
    ...(task ? { task } : {}),
    ...(followUp ? { followUp: true } : {}),
    ...(scope ? { scope } : {}),
    ...(thread?.artifact ? { artifact: thread.artifact } : {}),
    actions: Object.freeze(thread?.actions || []),
  })
}

function actionEvidenceLabel(action) {
  if (action.id === 'create-task' && action.status === 'completed') return action.resource?.title ? `A task was created: “${action.resource.title}”.` : 'A task was created from Chat.'
  if (action.id === 'save-note' && action.status === 'completed') return action.resource?.title ? `A note was saved: “${action.resource.title}”.` : 'A note was saved from Chat.'
  const names = { builder: 'Builder', code: 'Code AI', github: 'GitHub-preparation', youtube: 'YouTube AI' }
  if (action.status === 'handoff-opened' && names[action.id]) return `A ${names[action.id]} handoff was opened; that is not confirmation that downstream work was created or completed.`
  if (action.id === 'inspect-repo' && action.status === 'inspection-completed') return action.resource?.title
    ? `A bounded, read-only inspection was completed for ${action.resource.title}; it does not confirm every repository state or a code change.`
    : 'A bounded, read-only repository inspection was completed; it does not confirm every repository state or a code change.'
  if (action.id === 'prepare-branch' && action.status === 'branch-prepared') return action.resource?.title
    ? `A branch-first plan was prepared for ${action.resource.title}; no branch was created and no files were changed.`
    : 'A branch-first plan was prepared; no branch was created and no files were changed.'
  if (action.id === 'prepare-execution' && action.status === 'execution-prepared') return action.resource?.title
    ? `A bounded execution workflow was prepared for ${action.resource.title}; no branch, file change, test, or build is recorded.`
    : 'A bounded execution workflow was prepared; no branch, file change, test, or build is recorded.'
  if (action.id === 'approve-execution' && action.status === 'approval-recorded') return action.resource?.title
    ? `Approval was recorded for ${action.resource.title}; branch creation remains a separate explicit GitHub action and no repository mutation is recorded.`
    : 'Approval was recorded for a future execution workflow; branch creation remains a separate explicit GitHub action and no repository mutation is recorded.'
  if (action.id === 'create-branch' && action.status === 'branch-created') return action.resource?.title
    ? `GitHub confirmed branch creation for ${action.resource.title}; no files, tests, build, review, or merge are recorded.`
    : 'GitHub confirmed branch creation; no files, tests, build, review, or merge are recorded.'
  if (action.id === 'create-branch' && action.status === 'execution-blocked') return 'A requested branch action was blocked; no additional repository mutation is recorded.'
  return ''
}

export function getProjectAwarenessGuidance(awareness) {
  if (!awareness || (!awareness.objective && !awareness.project && !awareness.task && !awareness.artifact && !awareness.actions?.length)) return ''
  const notes = []
  if (awareness.scope === 'recent-memory') notes.push('This is a recent saved Chat working context, not the current thread. Use it because the user referred to earlier work; do not silently apply it to an unrelated new request.')
  if (awareness.objective) notes.push(`This thread's working objective is “${awareness.objective}”.`)
  if (awareness.project) notes.push(`Relevant saved project metadata: “${awareness.project.name}” (${awareness.project.type}). This identifies a workspace record; it does not confirm its files, repository, or deployment were inspected.`)
  if (awareness.task) notes.push(`Relevant saved task metadata: “${awareness.task.title}” (${awareness.task.status}). Treat its status as workspace metadata, not proof that work was verified.`)
  if (awareness.artifact) notes.push(awareness.scope === 'recent-memory'
    ? `A prior Chat ${awareness.artifact} is recorded, but its raw content is not loaded into this thread. Do not pretend to have its exact text or code; ask the user to open it or regenerate the relevant part when exact detail matters.`
    : `The current thread contains a prior Chat ${awareness.artifact}; reuse it instead of recreating work unless the user asks for a new version.`)
  const actionEvidence = awareness.actions?.map(actionEvidenceLabel).filter(Boolean) || []
  if (actionEvidence.length) notes.push(`Verified thread evidence: ${actionEvidence.join(' ')}`)
  notes.push('Reuse this context for a continuation or revision. If the user asks for a different project or task and the reference remains ambiguous, ask one concise clarifying question rather than guessing.')
  return notes.join(' ')
}
