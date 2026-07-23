// Backwards-compatible request-intent entry point. The orchestrator owns the
// classifier so Chat prompts, UI handoffs, and future execution routes share
// one task model rather than parallel regex paths.
export { classifyChatRequest, getChatIntentGuidance } from './chatOrchestrator.js'
