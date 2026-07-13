export const GENERATED_PREVIEW_SANDBOX = 'allow-scripts'
export const GENERATED_PREVIEW_REFERRER_POLICY = 'no-referrer'

export function isRestrictivePreviewSandbox(value) {
  return value === GENERATED_PREVIEW_SANDBOX
}
