/**
 * One small, deterministic request classifier keeps Chat's planning prompt
 * and its visible FounderLab handoffs in agreement. It recognises only
 * actions that the product can actually perform after an explicit click.
 */
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

function hasPlanningIntent(text) {
  return /\b(?:plan|roadmap|milestones?|phases?|strategy|brief|scope|approach)\b/i.test(text)
}

/**
 * Classify the product intent without turning natural language into a command
 * language. A single primary destination prevents conflicting handoffs while
 * note/task capture can remain an additional, user-confirmed action.
 */
export function classifyChatRequest(value = '') {
  const text = requestText(value)
  if (!text) {
    return Object.freeze({
      intents: Object.freeze([]),
      primaryTool: '',
      requiresPlan: false,
      wantsTask: false,
      wantsNote: false,
    })
  }

  const wantsTask = hasTaskIntent(text)
  const wantsNote = hasNoteIntent(text)
  const toolMatches = {
    youtube: hasYouTubeIntent(text),
    github: hasGitHubIntent(text),
    builder: hasBuilderIntent(text),
    code: hasCodeIntent(text),
  }
  const primaryTool = ['youtube', 'github', 'builder', 'code'].find((tool) => toolMatches[tool]) || ''
  const intents = [
    ...(wantsTask ? ['task'] : []),
    ...(wantsNote ? ['note'] : []),
    ...(primaryTool ? [primaryTool] : []),
    ...(!primaryTool && hasPlanningIntent(text) ? ['planning'] : []),
  ]

  return Object.freeze({
    intents: Object.freeze(intents),
    primaryTool,
    requiresPlan: Boolean(primaryTool || hasPlanningIntent(text)),
    wantsTask,
    wantsNote,
  })
}

/**
 * Provider-neutral guidance added only for requests where an execution plan
 * or workspace handoff makes the answer more useful. No action is performed
 * from this signal; it only makes the response and optional buttons coherent.
 */
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
