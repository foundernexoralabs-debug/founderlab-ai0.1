export const MOBILE_NAVIGATION_MAX_WIDTH = 767

/**
 * FounderLab shows its full left navigation at tablet, laptop, and desktop
 * widths. The compact top/bottom navigation is reserved for phone-width
 * viewports, so the two navigation systems are never mounted together.
 */
export function isMobileNavigationViewport(width) {
  return Number.isFinite(width) && width <= MOBILE_NAVIGATION_MAX_WIDTH
}

export function getMobileNavigationMode(windowLike = globalThis.window) {
  if (!windowLike) return false
  if (typeof windowLike.matchMedia === 'function') {
    return windowLike.matchMedia(`(max-width: ${MOBILE_NAVIGATION_MAX_WIDTH}px)`).matches
  }
  return isMobileNavigationViewport(windowLike.innerWidth)
}
