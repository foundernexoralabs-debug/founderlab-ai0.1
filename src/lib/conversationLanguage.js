const LEADING_HESITATION = /^\s*(?:um+|uh+|erm+)\s*[,;:-]?\s*/i
const SELF_CORRECTION = /(?:^|[,;.!?]\s*)(?:(?:no|sorry)[,;]?\s*)?(?:i\s+(?:mean|meant)|let me rephrase|correction|actually|to be clear)\s*[:,;]?\s+(.+)$/i

/** Keep harmless verbal fillers out of the final composed request, not out of live interim feedback. */
export function normalizeFinalSpokenPhrase(value = '') {
  return String(value || '').replace(LEADING_HESITATION, '').replace(/\s+/g, ' ').trim()
}

/**
 * A correction marker is deliberate user input. Returning only the latest
 * correction lets recognition replace the mistaken local phrase without
 * rewriting a broader conversation or silently guessing at intent.
 */
export function getExplicitSelfCorrection(value = '') {
  const phrase = normalizeFinalSpokenPhrase(value)
  return phrase.match(SELF_CORRECTION)?.[1]?.trim() || ''
}

export function hasExplicitSelfCorrection(value = '') {
  return Boolean(getExplicitSelfCorrection(value))
}

function speechWords(value = '') {
  return normalizeFinalSpokenPhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function isSmallWordCorrection(left = '', right = '') {
  if (!left || !right || Math.abs(left.length - right.length) > 1) return false
  let leftIndex = 0
  let rightIndex = 0
  let edits = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }
  return edits + (left.length - leftIndex) + (right.length - rightIndex) <= 1
}

/**
 * Recognition engines can finalise a false start and its corrected restart as
 * two phrases. Replace only when the second phrase clearly extends most of
 * the first; unrelated same-length phrases remain distinct user turns.
 */
export function isLikelyRestartExtension(previous = '', next = '') {
  const previousWords = speechWords(previous)
  const nextWords = speechWords(next)
  if (!previousWords.length || nextWords.length <= previousWords.length) return false
  let commonPrefix = 0
  while (commonPrefix < previousWords.length && previousWords[commonPrefix] === nextWords[commonPrefix]) {
    commonPrefix += 1
  }
  const laterPreviousWords = previousWords.slice(commonPrefix)
  const laterNextWords = new Set(nextWords.slice(commonPrefix))
  const sharedLaterWordCount = laterPreviousWords.filter((word) => laterNextWords.has(word)).length
  const requiredPrefix = Math.min(3, previousWords.length)
  if (commonPrefix >= requiredPrefix && commonPrefix / previousWords.length >= 0.6) return true
  // A single misheard word in an otherwise repeated phrase is a common
  // speech-recognition correction. Keep this intentionally narrow so two
  // separate requests that merely share generic words are never merged.
  return commonPrefix >= 2
    && sharedLaterWordCount >= 1
    && isSmallWordCorrection(previousWords[commonPrefix], nextWords[commonPrefix])
}
