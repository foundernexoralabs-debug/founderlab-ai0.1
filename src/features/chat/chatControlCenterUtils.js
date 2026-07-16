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
})

function requestText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function hasTaskIntent(text) {
  return /\b(?:turn|make|create|add|convert|break|put)\b[^.?!]{0,64}\b(?:into|as)?\s*(?:a\s+)?task\b/i.test(text)
}

function hasNoteIntent(text) {
  return /\b(?:save|turn|make|put|convert|keep)\b[^.?!]{0,64}\b(?:as|in|into)?\s*(?:a\s+)?note(?:s)?\b/i.test(text)
}

function hasBuilderIntent(text) {
  return /\b(?:use|open|send|take|continue)\b[^.?!]{0,64}\b(?:builder|website|landing page|web app|app)\b/i.test(text)
    || /\b(?:help me|build|create|make)\b[^.?!]{0,64}\b(?:website|landing page|web app|app|application|saas|product site)\b/i.test(text)
    || /\b(?:project plan|plan (?:this|the|my) (?:project|app|website)|make this into a project)\b/i.test(text)
}

function hasGitHubIntent(text) {
  return /\b(?:prepare|push|publish|send|open|use|connect|commit|create|make)\b[^.?!]{0,80}\b(?:github|repository|repo|pull request)\b/i.test(text)
}

function hasCodeIntent(text) {
  return /\b(?:build|create|make|write|implement|debug|refactor|test|review|fix|continue)\b[^.?!]{0,80}\b(?:code|coding|component|feature|implementation|test suite|api)\b/i.test(text)
}

function hasYouTubeIntent(text) {
  return /\b(?:use|turn|make|create|plan|develop|repurpose|prepare)\b[^.?!]{0,80}\b(?:youtube|video content|content idea|content strategy|shorts?|reels?)\b/i.test(text)
}

/**
 * Maps a natural-language request to only actions FounderLab can genuinely
 * perform today. The user still explicitly chooses every persistence or
 * navigation action; Chat never silently writes workspace data or pushes code.
 */
export function getChatControlActions(request) {
  const text = requestText(request)
  if (!text) return []

  const actions = []
  if (hasTaskIntent(text)) actions.push(CONTROL_ACTIONS['create-task'])
  if (hasNoteIntent(text)) actions.push(CONTROL_ACTIONS['save-note'])

  if (hasYouTubeIntent(text)) {
    actions.push(CONTROL_ACTIONS.youtube)
  } else if (hasGitHubIntent(text)) {
    actions.push(CONTROL_ACTIONS.github)
  } else if (hasBuilderIntent(text)) {
    actions.push(CONTROL_ACTIONS.builder)
  } else if (hasCodeIntent(text)) {
    actions.push(CONTROL_ACTIONS.code)
  }

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
export function getAssistantControlActions(messages, assistantIndex) {
  if (messages?.[assistantIndex]?.role !== 'assistant') return []
  const request = getPreviousUserRequest(messages, assistantIndex)
  return getChatControlActions(request).map((action) => Object.freeze({ ...action, request }))
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
