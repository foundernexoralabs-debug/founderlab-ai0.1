import { classifyChatRequest } from './chatRequestIntent.js'
import { getCompletedOrchestrationActions } from './chatOrchestrator.js'
import { getExecutionBridgeHandoffAction } from './chatExecutionBridge.js'
import { getCapabilityBridgeHandoffAction } from './chatCapabilityBridge.js'
import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'
import { normalizeExecutionWorkflow } from './chatExecutionWorkflow.js'

const MAX_HANDOFF_TEXT_LENGTH = 6000

const CONTROL_ACTIONS = Object.freeze({
  'save-note': Object.freeze({
    id: 'save-note',
    label: 'Save response',
    detail: 'Add this to Notes',
    icon: '◫',
    completedLabel: 'Saved',
  }),
  'create-task': Object.freeze({
    id: 'create-task',
    label: 'Create task',
    detail: 'Add a next step',
    icon: '✓',
    completedLabel: 'Created',
  }),
  builder: Object.freeze({
    id: 'builder',
    label: 'Open in Builder',
    detail: 'Carry this brief forward',
    icon: '⬡',
    target: 'builder',
    completedLabel: 'Opened',
  }),
  code: Object.freeze({
    id: 'code',
    label: 'Open Code AI',
    detail: 'Continue with an implementation plan',
    icon: '⌨',
    target: 'code',
    completedLabel: 'Opened',
  }),
  github: Object.freeze({
    id: 'github',
    label: 'Prepare in Code AI',
    detail: 'Review code before any GitHub action',
    icon: '⌘',
    target: 'code',
    completedLabel: 'Opened',
  }),
  youtube: Object.freeze({
    id: 'youtube',
    label: 'Open YouTube AI',
    detail: 'Turn this into a content brief',
    icon: '▶',
    target: 'youtube',
    completedLabel: 'Opened',
  }),
  'inspect-repo': Object.freeze({
    id: 'inspect-repo',
    label: 'Inspect repository',
    detail: 'Read public GitHub metadata and file paths',
    icon: '⌕',
    completedLabel: 'Inspected',
  }),
  'prepare-branch': Object.freeze({
    id: 'prepare-branch',
    label: 'Prepare branch plan',
    detail: 'Propose a safe branch-first change',
    icon: '⎇',
    completedLabel: 'Prepared',
  }),
  'prepare-execution': Object.freeze({
    id: 'prepare-execution',
    label: 'Prepare execution workflow',
    detail: 'Scope candidate files and validation',
    icon: '◈',
    completedLabel: 'Prepared',
  }),
  'approve-execution': Object.freeze({
    id: 'approve-execution',
    label: 'Record execution approval',
    detail: 'Approve a future branch-first workflow',
    icon: '✓',
    completedLabel: 'Approved',
  }),
  'create-branch': Object.freeze({
    id: 'create-branch',
    label: 'Create approved branch',
    detail: 'Create only the approved GitHub branch',
    icon: '⎇',
    completedLabel: 'Created',
  }),
  'apply-file-change': Object.freeze({
    id: 'apply-file-change',
    label: 'Apply reviewed file change',
    detail: 'Review and commit one inspected candidate file',
    icon: '✦',
    completedLabel: 'Applied',
  }),
  validate: Object.freeze({
    id: 'validate',
    label: 'Check GitHub validation',
    detail: 'Read native checks for the committed change',
    icon: '✓',
    completedLabel: 'Checked',
  }),
  review: Object.freeze({
    id: 'review',
    label: 'Prepare review summary',
    detail: 'Record a review-ready change only after validation',
    icon: '◈',
    completedLabel: 'Ready',
  }),
  'retry-execution': Object.freeze({
    id: 'retry-execution',
    label: 'Restore retry path',
    detail: 'Clear a retryable execution block without repeating work',
    icon: '↻',
    completedLabel: 'Restored',
  }),
  'connect-github': Object.freeze({
    id: 'connect-github',
    label: 'Connect GitHub',
    detail: 'Enable an explicitly approved branch action',
    icon: '⌘',
    target: 'settings',
    completedLabel: 'Opened',
  }),
})

function requestText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Maps a natural-language request to only actions FounderLab can genuinely
 * perform today. The user still explicitly chooses every persistence or
 * navigation action; Chat never silently writes workspace data or pushes code.
 */
export function getChatControlActions(request) {
  const text = requestText(request)
  if (!text) return []
  const intent = classifyChatRequest(text)

  const actions = []
  if (intent.wantsTask) actions.push(CONTROL_ACTIONS['create-task'])
  if (intent.wantsNote) actions.push(CONTROL_ACTIONS['save-note'])

  const repository = parsePublicGithubRepositoryReference(text)
  const repositoryWork = Boolean(repository) || /\b(?:repository|repo|codebase|branch|pull request|commit|bug|crash|debug|refactor)\b/i.test(text)
  if (repository && intent.isOperational && ['inspect', 'change', 'create', 'continue', 'handoff'].includes(intent.operation)) {
    actions.push(CONTROL_ACTIONS['inspect-repo'])
  }

  if (intent.primaryTool && !repositoryWork) actions.push(CONTROL_ACTIONS[intent.primaryTool])

  return actions.slice(0, 2)
}

function getPreviousUserRequest(messages, assistantIndex) {
  if (!Array.isArray(messages) || !Number.isInteger(assistantIndex)) return ''
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return requestText(messages[index].content)
  }
  return ''
}

/** Attach the triggering request in-memory so a clicked action transfers the right brief. */
export function getAssistantControlActions(messages, assistantIndex, { githubConnected = false } = {}) {
  if (messages?.[assistantIndex]?.role !== 'assistant') return []
  const assistant = messages[assistantIndex]
  const request = getPreviousUserRequest(messages, assistantIndex)
  const completed = new Map(getCompletedOrchestrationActions(assistant.orchestration)
    .map((action) => [action.id, action.status]))
  let actions = getChatControlActions(request)
  const inspectionCompleted = completed.get('inspect-repo') === 'inspection-completed'
  const branchPrepared = completed.get('prepare-branch') === 'branch-prepared'
  const executionPrepared = completed.get('prepare-execution') === 'execution-prepared'
  const approvalRecorded = completed.get('approve-execution') === 'approval-recorded'
  const workflow = normalizeExecutionWorkflow(assistant.orchestration?.workflow)
  const fileChangeApplied = completed.get('apply-file-change') === 'change-applied'
  const validationComplete = [workflow?.validation?.tests, workflow?.validation?.build, workflow?.validation?.report]
    .every((state) => ['passed', 'not-needed'].includes(state))
  const branchRequired = assistant.orchestration?.execution?.branch === 'required'
  if (workflow?.block?.retryable) {
    actions = [CONTROL_ACTIONS['retry-execution']]
  }
  if (!workflow?.block?.retryable && inspectionCompleted) {
    actions = actions.filter((action) => action.id !== 'inspect-repo')
    if (branchRequired && !branchPrepared) {
      actions.push(CONTROL_ACTIONS['prepare-branch'])
    } else if (branchRequired && branchPrepared && !executionPrepared) {
      actions.push(CONTROL_ACTIONS['prepare-execution'])
    } else if (branchRequired && executionPrepared && !approvalRecorded) {
      actions.push(CONTROL_ACTIONS['approve-execution'])
    } else if (branchRequired && approvalRecorded && workflow?.branch?.state === 'planned') {
      if (githubConnected && (!workflow.block || workflow.block.retryable)) {
        actions.push(CONTROL_ACTIONS['create-branch'])
      } else if (!githubConnected && !workflow.block) {
        actions.push(CONTROL_ACTIONS['connect-github'])
      }
    } else if (branchRequired && approvalRecorded && workflow?.branch?.state === 'created' && workflow.change.state === 'prepared' && !workflow.block) {
      actions.push(githubConnected ? CONTROL_ACTIONS['apply-file-change'] : CONTROL_ACTIONS['connect-github'])
    } else if (branchRequired && fileChangeApplied && workflow?.change?.state === 'applied' && !workflow.block && !validationComplete) {
      actions.push(githubConnected ? CONTROL_ACTIONS.validate : CONTROL_ACTIONS['connect-github'])
    } else if (branchRequired && fileChangeApplied && workflow?.change?.state === 'applied' && !workflow.block && validationComplete && workflow.review === 'awaiting-executor') {
      actions.push(CONTROL_ACTIONS.review)
    }
  }
  const executionHandoff = getExecutionBridgeHandoffAction(assistant.orchestration?.execution)
  const capabilityHandoff = getCapabilityBridgeHandoffAction(assistant.orchestration?.capabilities)
  const continuationAction = executionHandoff || capabilityHandoff
  if (continuationAction && !actions.some((action) => action.id === continuationAction) && CONTROL_ACTIONS[continuationAction]) {
    actions.push(CONTROL_ACTIONS[continuationAction])
  }
  const isCompleted = (action) => {
    const status = completed.get(action.id)
    if (action.id === 'validate') return ['validation-passed', 'validation-failed'].includes(status)
    if (action.id === 'review') return status === 'review-ready'
    return completed.has(action.id)
  }
  return actions.slice(0, 2).map((action) => Object.freeze({
    ...action,
    request,
    ...(isCompleted(action) ? { completed: true, completionStatus: completed.get(action.id) } : {}),
  }))
}

function trimHandoffText(value, limit = MAX_HANDOFF_TEXT_LENGTH) {
  const text = requestText(value)
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`
}

/**
 * Destination tools own their execution model and permissions. Chat sends a
 * bounded text brief only, so Local Ollama remains local to Chat today while
 * Builder/Code can adopt their own future local-model path without coupling.
 */
export function buildChatHandoffPayload(actionId, { request = '', response = '' } = {}) {
  const userGoal = trimHandoffText(request, 1800)
  const workingResponse = trimHandoffText(response, 4200)
  const brief = [
    'FounderLab Chat brief',
    userGoal ? `User goal:\n${userGoal}` : '',
    workingResponse ? `Working response:\n${workingResponse}` : '',
  ].filter(Boolean).join('\n\n')

  if (actionId === 'builder') return { desc: `Create a polished project from this brief:\n\n${brief}` }
  if (actionId === 'code' || actionId === 'github') {
    const prefix = actionId === 'github'
      ? 'Review this plan, then prepare the implementation for a deliberate GitHub workflow. Do not push anything until the user explicitly confirms.'
      : 'Use this plan as the implementation brief. Start with the smallest useful architecture and verify before expanding scope.'
    return { desc: `${prefix}\n\n${brief}` }
  }
  if (actionId === 'youtube') return { title: trimHandoffText(userGoal || workingResponse, 480) }
  return null
}
