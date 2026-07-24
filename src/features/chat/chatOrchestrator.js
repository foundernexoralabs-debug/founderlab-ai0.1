/**
 * The Chat orchestrator is deliberately a deterministic, provider-neutral
 * layer. It gives every model the same bounded view of what the user is
 * trying to do and what FounderLab can prove happened in this thread.
 *
 * It never turns model output into an action. Explicit Chat controls may run
 * a narrowly approved integration action, and this layer stores only the
 * resulting evidence. That boundary prevents a helpful plan from becoming an
 * unverified execution claim.
 */

import { normalizeExecutionBridgeEvidence } from './chatExecutionBridge.js'
import { normalizeCapabilityBridge } from './chatCapabilityBridge.js'
import { normalizeExecutionWorkflow } from './chatExecutionWorkflow.js'
import {
  getConnectorActionEvidence,
  normalizeConnectorActionEvidence,
  normalizeConnectorPlan,
  refreshConnectorPlanForExecution,
} from './chatConnectorFramework.js'
import {
  isChatExecutionActionId,
  isChatExecutionActionStatus,
  isChatExecutionResourceType,
} from './chatExecutionVocabulary.js'

const MAX_ACTION_EVIDENCE = 12
const MAX_OBJECTIVE_LENGTH = 220

const TOOL_RULES = Object.freeze({
  youtube: Object.freeze({
    phrases: Object.freeze(['youtube', 'video content', 'content strategy', 'youtube short', 'youtube shorts', 'reel', 'reels']),
    tokens: Object.freeze(['youtube', 'shorts', 'reels']),
  }),
  github: Object.freeze({
    phrases: Object.freeze(['github', 'pull request', 'git repository', 'code repository']),
    tokens: Object.freeze(['github', 'repository', 'repo']),
  }),
  builder: Object.freeze({
    phrases: Object.freeze(['website', 'landing page', 'web app', 'product site', 'saas', 'app', 'founderlab builder', 'project plan']),
    tokens: Object.freeze(['builder', 'website', 'application']),
  }),
  code: Object.freeze({
    phrases: Object.freeze(['code ai', 'test suite', 'api endpoint', 'codebase', 'software component']),
    tokens: Object.freeze(['code', 'coding', 'component', 'feature', 'implementation', 'debug', 'refactor', 'test', 'api']),
  }),
})

const TOOL_PRIORITY = Object.freeze(['youtube', 'github', 'builder', 'code'])
const TASK_PHRASES = Object.freeze(['into a task', 'as a task', 'create a task', 'add a task', 'make a task', 'task for'])
const NOTE_PHRASES = Object.freeze(['into a note', 'as a note', 'save this note', 'save in notes', 'save to notes', 'keep this note'])
const PLAN_PHRASES = Object.freeze(['project plan', 'make a plan', 'create a plan', 'plan this', 'plan the', 'roadmap', 'milestone', 'strategy', 'scope', 'approach', 'brief'])
const REFERENCE_PHRASES = Object.freeze([
  'that answer', 'this answer', 'the answer above', 'the code above', 'that code', 'this code', 'the plan above', 'that plan', 'this plan',
  'the thing you just made', 'what you just made', 'what you just said', 'continue from that', 'continue from this', 'fix that', 'fix this',
  'improve that', 'improve this', 'use that', 'use this', 'apply that', 'apply this', 'adapt that', 'adapt this',
])
const FULL_REPEAT_PHRASES = Object.freeze(['show it again', 'show the full', 'full code again', 'full answer again', 'repeat the', 'repost the', 'resend the', 'paste the'])
const INSPECT_TERMS = Object.freeze(['inspect', 'review', 'audit', 'check', 'verify', 'diagnose', 'analyze'])
const CREATE_TERMS = Object.freeze(['build', 'create', 'make', 'write', 'implement', 'generate', 'draft'])
const CHANGE_TERMS = Object.freeze(['fix', 'debug', 'refactor', 'improve', 'change', 'update', 'repair'])
const ROUTE_TERMS = Object.freeze(['open', 'send', 'prepare', 'use', 'continue', 'turn', 'convert', 'save', 'add'])
const FOLLOW_UP_TERMS = Object.freeze(['continue', 'fix', 'improve', 'use', 'apply', 'adapt', 'explain', 'summarize', 'change', 'update'])

function requestText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedText(value) {
  return requestText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(value) {
  return new Set(normalizedText(value).split(' ').filter(Boolean))
}

function hasPhrase(normalized, phrase) {
  return ` ${normalized} `.includes(` ${phrase} `)
}

function countMatches(normalized, presentTokens, candidateTokens = [], phrases = []) {
  const phraseScore = phrases.reduce((score, phrase) => score + (hasPhrase(normalized, phrase) ? 3 : 0), 0)
  const tokenScore = candidateTokens.reduce((score, token) => score + (presentTokens.has(token) ? 1 : 0), 0)
  return phraseScore + tokenScore
}

function includesAny(normalized, tokens, candidates) {
  return candidates.some((candidate) => candidate.includes(' ')
    ? hasPhrase(normalized, candidate)
    : tokens.has(candidate))
}

function getToolMatches(value) {
  const normalized = normalizedText(value)
  const tokens = tokenSet(value)
  return TOOL_PRIORITY.map((tool) => {
    const rule = TOOL_RULES[tool]
    return Object.freeze({ tool, score: countMatches(normalized, tokens, rule.tokens, rule.phrases) })
  }).filter((match) => match.score > 0)
}

function detectOperation(value, { wantsTask = false, wantsNote = false, hasReference = false } = {}) {
  const normalized = normalizedText(value)
  const tokens = tokenSet(value)
  if (wantsTask || wantsNote) return 'capture'
  if (hasReference && includesAny(normalized, tokens, FOLLOW_UP_TERMS)) return 'continue'
  if (includesAny(normalized, tokens, INSPECT_TERMS)) return 'inspect'
  if (includesAny(normalized, tokens, PLAN_PHRASES)) return 'plan'
  if (includesAny(normalized, tokens, CHANGE_TERMS)) return 'change'
  if (includesAny(normalized, tokens, CREATE_TERMS)) return 'create'
  if (includesAny(normalized, tokens, ROUTE_TERMS)) return 'handoff'
  return 'explain'
}

function getPrimaryTool(value) {
  const normalized = normalizedText(value)
  const tokens = tokenSet(value)
  // A product/tool name in a factual question (for example “What is GitHub?”)
  // is conversation, not a request to launch a workflow. Require an execution
  // or planning signal before exposing a destination handoff.
  const hasDestinationSignal = includesAny(normalized, tokens, [
    ...CREATE_TERMS,
    ...CHANGE_TERMS,
    ...ROUTE_TERMS,
    ...PLAN_PHRASES,
  ])
  if (!hasDestinationSignal) return ''
  const matches = getToolMatches(value)
  if (!matches.length) return ''
  const highestScore = Math.max(...matches.map((match) => match.score))
  return matches.find((match) => match.score === highestScore)?.tool || ''
}

function getMode({ operation, primaryTool, planning, hasReference }) {
  if (hasReference && ['continue', 'change', 'inspect'].includes(operation)) return 'follow-up'
  if (operation === 'plan' || planning) return 'planning'
  if (primaryTool || ['capture', 'create', 'change', 'inspect', 'handoff'].includes(operation)) return 'operator'
  return 'conversation'
}

function getIntentSignals(value, { wantsTask, wantsNote, primaryTool, planning, hasReference, operation }) {
  const signals = []
  if (wantsTask) signals.push('task-capture')
  if (wantsNote) signals.push('note-capture')
  if (primaryTool) signals.push(`${primaryTool}-target`)
  if (planning) signals.push('planning')
  if (hasReference) signals.push('thread-reference')
  if (operation !== 'explain') signals.push(operation)
  return Object.freeze(signals)
}

/**
 * Natural-language classification with transparent, composable signals.
 * This intentionally avoids treating every action as a single regex-shaped
 * command while retaining deterministic behavior across cloud and local models.
 */
export function classifyChatRequest(value = '', { hasThreadReference = false } = {}) {
  const text = requestText(value)
  if (!text) {
    return Object.freeze({
      intents: Object.freeze([]),
      primaryTool: '',
      requiresPlan: false,
      wantsTask: false,
      wantsNote: false,
      mode: 'conversation',
      operation: 'explain',
      isOperational: false,
      signals: Object.freeze([]),
    })
  }

  const normalized = normalizedText(text)
  const tokens = tokenSet(text)
  const wantsTask = TASK_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
    || (tokens.has('task') && includesAny(normalized, tokens, ROUTE_TERMS))
  const wantsNote = NOTE_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
    || ((tokens.has('note') || tokens.has('notes')) && includesAny(normalized, tokens, ROUTE_TERMS))
  const planning = includesAny(normalized, tokens, PLAN_PHRASES)
  const primaryTool = getPrimaryTool(text)
  const operation = detectOperation(text, { wantsTask, wantsNote, hasReference: hasThreadReference })
  const mode = getMode({ operation, primaryTool, planning, hasReference: hasThreadReference })
  const intents = [
    ...(wantsTask ? ['task'] : []),
    ...(wantsNote ? ['note'] : []),
    ...(primaryTool ? [primaryTool] : []),
    ...(!primaryTool && planning ? ['planning'] : []),
  ]

  return Object.freeze({
    intents: Object.freeze(intents),
    primaryTool,
    requiresPlan: Boolean(primaryTool || planning),
    wantsTask,
    wantsNote,
    mode,
    operation,
    isOperational: mode === 'operator' || mode === 'planning',
    signals: getIntentSignals(text, { wantsTask, wantsNote, primaryTool, planning, hasReference: hasThreadReference, operation }),
  })
}

/** Provider-neutral planning guidance for a request that is genuinely operational. */
export function getChatIntentGuidance(intent) {
  if (!intent?.requiresPlan) return ''
  const destinationGuidance = {
    builder: 'Prepare a compact product brief: outcome, intended audience, key experience or sections, and the first build decision. Infer ordinary product choices and only ask about a genuinely blocking constraint. The interface may offer an explicit Builder handoff after the response.',
    code: 'Prepare a compact implementation plan: outcome, smallest safe architecture, first implementation step, and verification. Do not claim code was changed until the user explicitly continues in Code AI.',
    github: 'Prepare a compact repository plan: intended change, implementation steps, verification, and the safe GitHub next step. Do not imply a repository, commit, push, or pull request exists until the user explicitly confirms it.',
    youtube: 'Prepare a compact content brief: audience, angle, hook, format, and the next production step. The interface may offer an explicit YouTube AI handoff after the response.',
  }
  const base = destinationGuidance[intent.primaryTool]
    || 'Create a compact project plan with the goal, the first two or three milestones, and one practical next action. Do not force a tool choice when the destination is not clear.'
  const capture = intent.wantsTask || intent.wantsNote
    ? ' Give the useful result first; the interface may then offer the user an explicit save action. Never claim the capture already happened.'
    : ''
  return `${base}${capture}`
}

function getPreviousAssistant(messages, latestUserIndex) {
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && requestText(message.content)) return message
  }
  return null
}

function getArtifactKind(message) {
  const content = requestText(message?.content)
  if (!content) return 'response'
  if (content.includes('```')) return 'code'
  if (/\b(?:plan|milestone|phase|step 1|next step)\b/i.test(content)) return 'plan'
  return 'response'
}

function getReferenceState(value, previousAssistant) {
  const normalized = normalizedText(value)
  const tokens = tokenSet(value)
  const referencesPrevious = REFERENCE_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
    || (includesAny(normalized, tokens, FOLLOW_UP_TERMS) && ['that', 'this', 'it'].some((token) => tokens.has(token)))
  const explicitlyRequestsFullRepeat = FULL_REPEAT_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
    || (tokens.has('full') && includesAny(normalized, tokens, ['code', 'answer', 'plan']))
  return Object.freeze({
    referencesPrevious: Boolean(previousAssistant && (referencesPrevious || explicitlyRequestsFullRepeat)),
    explicitlyRequestsFullRepeat,
    artifactKind: previousAssistant ? getArtifactKind(previousAssistant) : '',
  })
}

function getRecentActionEvidence(messages) {
  const evidence = []
  for (let index = messages.length - 1; index >= 0 && evidence.length < MAX_ACTION_EVIDENCE; index -= 1) {
    const actions = messages[index]?.orchestration?.actions
    if (!Array.isArray(actions)) continue
    actions.forEach((action) => {
      if (evidence.length >= MAX_ACTION_EVIDENCE || !action?.id || !action?.status) return
      evidence.push(Object.freeze({ id: action.id, status: action.status }))
    })
  }
  return Object.freeze(evidence.reverse())
}

function getRecentExecutionWorkflow(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const workflow = normalizeExecutionWorkflow(messages[index]?.orchestration?.workflow)
    if (workflow) return workflow
  }
  return null
}

function getRecentConnectorPlan(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const plan = normalizeConnectorPlan(messages[index]?.orchestration?.connectorPlan)
    if (plan) return plan
  }
  return null
}

function getActiveObjective(messages, latestUserIndex) {
  for (let index = latestUserIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || !requestText(message.content)) continue
    // A deictic follow-up such as “continue from that” inherits its objective
    // from the prior operational request; it is not a replacement objective.
    if (index === latestUserIndex && getReferenceState(message.content, getPreviousAssistant(messages, index)).referencesPrevious) continue
    const intent = classifyChatRequest(message.content)
    if (intent.isOperational || intent.requiresPlan) {
      return requestText(message.content).slice(0, MAX_OBJECTIVE_LENGTH)
    }
  }
  return ''
}

/**
 * Snapshot the current thread using only persisted Chat messages and explicit
 * action evidence. It never invents external repository, project, task, or
 * deployment state.
 */
export function getChatOrchestrationContext(messages = []) {
  const items = Array.isArray(messages) ? messages : []
  const latestUserIndex = items.map((message) => message?.role).lastIndexOf('user')
  if (latestUserIndex < 0) {
    const intent = classifyChatRequest('')
    return Object.freeze({ intent, reference: Object.freeze({ referencesPrevious: false, explicitlyRequestsFullRepeat: false, artifactKind: '' }), activeObjective: '', actionEvidence: Object.freeze([]), executionWorkflow: null, connectorPlan: null })
  }
  const latestUser = items[latestUserIndex]
  const previousAssistant = getPreviousAssistant(items, latestUserIndex)
  const reference = getReferenceState(latestUser?.content, previousAssistant)
  const intent = classifyChatRequest(latestUser?.content, { hasThreadReference: reference.referencesPrevious })
  return Object.freeze({
    intent,
    reference,
    activeObjective: getActiveObjective(items, latestUserIndex),
    actionEvidence: getRecentActionEvidence(items),
    executionWorkflow: getRecentExecutionWorkflow(items),
    connectorPlan: getRecentConnectorPlan(items),
  })
}

function evidenceLabel({ id, status }) {
  const labels = {
    'save-note': status === 'completed' ? 'A note was saved from a Chat response.' : 'A note action was prepared but not confirmed complete.',
    'create-task': status === 'completed' ? 'A task was created from a Chat response.' : 'A task action was prepared but not confirmed complete.',
    builder: status === 'handoff-opened' ? 'A Builder handoff was opened; this does not confirm a Builder project was created.' : 'A Builder handoff was prepared but not opened.',
    code: status === 'handoff-opened' ? 'A Code AI handoff was opened; this does not confirm code was changed.' : 'A Code AI handoff was prepared but not opened.',
    github: status === 'handoff-opened' ? 'A Code AI GitHub-preparation handoff was opened; no repository action is confirmed.' : 'A GitHub-preparation handoff was prepared but not opened.',
    youtube: status === 'handoff-opened' ? 'A YouTube AI handoff was opened; no content was published.' : 'A YouTube AI handoff was prepared but not opened.',
    'inspect-repo': status === 'inspection-completed' ? 'A bounded, read-only repository inspection was completed.' : '',
    'prepare-branch': status === 'branch-prepared' ? 'A branch-first change plan was prepared; no branch was created.' : '',
    'prepare-execution': status === 'execution-prepared' ? 'A branch-first execution workflow was prepared; no branch or files were changed.' : '',
    'approve-execution': status === 'approval-recorded' ? 'Approval for a future branch-first workflow was recorded; no execution ran.' : '',
    'create-branch': status === 'branch-created' ? 'GitHub confirmed branch creation; no file, validation, review, or merge is implied.' : '',
    'apply-file-change': status === 'change-applied' ? 'GitHub confirmed the reviewed multi-file commit on the approved branch; validation and human review remain separate.' : '',
    validate: status === 'validation-passed' ? 'GitHub supplied completed validation evidence for the committed change; human review is still required.'
      : status === 'validation-recorded' ? 'GitHub validation was read, but not all required completed evidence is available yet.'
        : status === 'validation-failed' ? 'GitHub reported failed validation; no review or merge readiness is claimed.' : '',
    review: status === 'review-ready' ? 'The committed file scope and validation evidence are ready for human review; no pull request or merge is confirmed.' : '',
  }
  return labels[id] || ''
}

/**
 * Model-facing behavior contract. The wording is generated from a concrete
 * snapshot rather than hoping a generic prompt remembers the same boundaries.
 */
export function getOrchestratorGuidance(context) {
  if (!context?.intent) return ''
  const hasSpecificState = context.intent.mode !== 'conversation'
    || context.reference?.referencesPrevious
    || context.actionEvidence?.length
    || context.executionWorkflow
  if (!hasSpecificState) return ''
  const notes = [
    'Operator integrity: inspect the provided thread evidence before making a status claim. Separate what the conversation proves, what you infer, and what you recommend next. A plan, draft, or handoff is not completed work.',
  ]
  const { intent, reference, activeObjective, actionEvidence } = context
  if (intent.mode !== 'conversation') {
    notes.push(`Current mode is ${intent.mode} (${intent.operation}). ${intent.isOperational ? 'Treat this as an operational request: give the useful plan or next action, but do not execute or claim execution without explicit evidence.' : 'Keep the response grounded in the active thread.'}`)
  }
  if (reference?.referencesPrevious) {
    const repeat = reference.explicitlyRequestsFullRepeat
      ? 'The user explicitly requested the prior material again; reproduce the relevant part cleanly.'
      : `The user refers to the immediately preceding ${reference.artifactKind || 'response'}; carry that work forward instead of restarting or rewriting it by default.`
    notes.push(repeat)
  }
  if (activeObjective) notes.push(`Current operational objective in this thread: “${activeObjective}”`)
  actionEvidence.map(evidenceLabel).filter(Boolean).forEach((label) => notes.push(`Verified thread evidence: ${label}`))
  if (context.executionWorkflow) {
    notes.push('A bounded branch-first execution workflow is recorded in this thread. Its state is evidence of preparation or approval only; do not claim a branch, file change, test, build, report, review, or merge unless explicit execution evidence is recorded.')
  }
  if (intent.isOperational) {
    notes.push('For an operator-style reply, make the outcome concrete: label a recommendation or prepared handoff as such, and reserve “completed” or “verified” for explicit thread evidence. Do not present a plan as execution.')
  }
  notes.push('If repository, project, deployment, task, or external workspace details are not present in this evidence, say they have not been inspected or are not confirmed. Offer the next safe inspection or handoff instead of implying completion.')
  return notes.join(' ')
}

export function createAssistantOrchestration(context) {
  const intent = context?.intent || classifyChatRequest('')
  const routing = normalizeRoutingEvidence(context?.modelRouting)
  const execution = normalizeExecutionBridgeEvidence(context?.executionBridge)
  const capabilities = normalizeCapabilityBridge(context?.capabilityBridge)
  const connectorPlan = normalizeConnectorPlan(context?.connectorPlan)
  const workflow = normalizeExecutionWorkflow(context?.executionWorkflow)
  return Object.freeze({
    version: 1,
    mode: intent.mode,
    operation: intent.operation,
    ...(intent.primaryTool ? { primaryTool: intent.primaryTool } : {}),
    ...(intent.requiresPlan ? { requiresPlan: true } : {}),
    ...(routing ? { routing } : {}),
    ...(execution && execution.readiness !== 'not-started' ? { execution } : {}),
    ...(connectorPlan ? { connectorPlan } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(workflow ? { workflow } : {}),
    actions: Object.freeze([]),
  })
}

const ROUTING_TASK_CLASSES = new Set(['conversation', 'planning', 'code', 'execution'])
const ROUTING_REASONING_LEVELS = new Set(['light', 'focused', 'high'])
const ROUTING_PATHS = new Set(['cloud', 'local'])
const ROUTING_PROVIDER_IDS = new Set(['anthropic', 'groq', 'gemini', 'ollama'])

function normalizeRoutingSelection(value) {
  if (!value || typeof value !== 'object' || !ROUTING_PROVIDER_IDS.has(value.provider) || !ROUTING_PATHS.has(value.path)) return null
  const model = requestText(value.model).slice(0, 160)
  if (!model) return null
  return Object.freeze({ provider: value.provider, model, path: value.path })
}

/**
 * Message-level routing evidence captures only the bounded model-path decision
 * made for that reply. It deliberately excludes prompt content, credentials,
 * availability internals, and any claim that the path executed product work.
 */
function normalizeRoutingEvidence(value) {
  if (!value || typeof value !== 'object' || !ROUTING_TASK_CLASSES.has(value.taskClass)) return null
  const selected = normalizeRoutingSelection(value.selected || value.current)
  if (!selected) return null
  const recommendation = normalizeRoutingSelection(value.recommendation)
  return Object.freeze({
    version: 1,
    taskClass: value.taskClass,
    reasoningLevel: ROUTING_REASONING_LEVELS.has(value.reasoningLevel) ? value.reasoningLevel : 'light',
    selected,
    ...(recommendation ? { recommendation } : {}),
  })
}

function normalizeActionResource(value) {
  if (!value || typeof value !== 'object' || !isChatExecutionResourceType(value.type)) return null
  const id = requestText(value.id).slice(0, 160)
  const title = requestText(value.title).replace(/\s+/g, ' ').slice(0, 120)
  if (!id || !title) return null
  return Object.freeze({ type: value.type, id, title })
}

function normalizeActionTimestamp(value) {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) return ''
  return value.slice(0, 40)
}

/** Keep action evidence compact, serializable, and impossible to confuse with an external artifact. */
export function normalizeMessageOrchestration(value) {
  if (!value || typeof value !== 'object') return null
  const mode = ['conversation', 'planning', 'operator', 'follow-up'].includes(value.mode) ? value.mode : 'conversation'
  const operation = ['explain', 'plan', 'capture', 'create', 'change', 'inspect', 'handoff', 'continue'].includes(value.operation) ? value.operation : 'explain'
  const routing = normalizeRoutingEvidence(value.routing)
  const execution = normalizeExecutionBridgeEvidence(value.execution)
  const capabilities = normalizeCapabilityBridge(value.capabilities)
  const connectorPlan = normalizeConnectorPlan(value.connectorPlan)
  const workflow = normalizeExecutionWorkflow(value.workflow)
  const actions = Array.isArray(value.actions)
    ? value.actions
      .filter((action) => action && isChatExecutionActionId(action.id) && isChatExecutionActionStatus(action.status))
      .slice(-MAX_ACTION_EVIDENCE)
      .map((action) => {
        const resource = normalizeActionResource(action.resource)
        const at = normalizeActionTimestamp(action.at)
        const connectorAction = normalizeConnectorActionEvidence(action.connectorAction)
        return Object.freeze({ id: action.id, status: action.status, ...(resource ? { resource } : {}), ...(connectorAction ? { connectorAction } : {}), ...(at ? { at } : {}) })
      })
    : []
  return Object.freeze({
    version: 1,
    mode,
    operation,
    ...(typeof value.primaryTool === 'string' && TOOL_PRIORITY.includes(value.primaryTool) ? { primaryTool: value.primaryTool } : {}),
    ...(value.requiresPlan === true ? { requiresPlan: true } : {}),
    ...(routing ? { routing } : {}),
    ...(execution ? { execution } : {}),
    ...(connectorPlan ? { connectorPlan } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(workflow ? { workflow } : {}),
    actions: Object.freeze(actions),
  })
}

export function recordOrchestrationAction(orchestration, { id, status, resource: actionResource, connectorAction: requestedConnectorAction, workflow: actionWorkflow, at: actionAt } = {}) {
  const current = normalizeMessageOrchestration(orchestration) || createAssistantOrchestration()
  if (!isChatExecutionActionId(id) || !isChatExecutionActionStatus(status)) return current
  const resource = normalizeActionResource(actionResource)
  const connectorAction = normalizeConnectorActionEvidence(requestedConnectorAction) || getConnectorActionEvidence({ id, status })
  const at = normalizeActionTimestamp(actionAt)
  const workflow = normalizeExecutionWorkflow(actionWorkflow) || current.workflow
  const connectorPlan = actionWorkflow ? refreshConnectorPlanForExecution(current.connectorPlan, workflow) : current.connectorPlan
  const duplicate = current.actions.some((action) => action.id === id && action.status === status && action.resource?.id === resource?.id)
  const actions = duplicate
    ? current.actions
    : [...current.actions, Object.freeze({ id, status, ...(resource ? { resource } : {}), ...(connectorAction ? { connectorAction } : {}), ...(at ? { at } : {}) })].slice(-MAX_ACTION_EVIDENCE)
  return Object.freeze({
    ...current,
    ...(workflow ? { workflow } : {}),
    ...(connectorPlan ? { connectorPlan } : {}),
    actions: Object.freeze(actions),
  })
}

export function getCompletedOrchestrationActions(orchestration) {
  const normalized = normalizeMessageOrchestration(orchestration)
  return Object.freeze(normalized?.actions || [])
}
