// Lightweight helpers for targeted section editing of generated single-file HTML.
// Generated pages are instructed to tag each section with data-section="hero" etc.

export const KNOWN_SECTIONS = ['navbar','hero','social-proof','features','how-it-works','testimonial','pricing','cta','footer']

const SECTION_KEYWORDS = {
  navbar: ['navbar','nav bar','navigation','menu'],
  hero: ['hero','headline','banner'],
  features: ['feature','cards','card grid'],
  pricing: ['pricing','price','plan'],
  testimonial: ['testimonial','review','quote'],
  footer: ['footer'],
  'how-it-works': ['how it works','steps','how-it-works'],
  cta: ['cta','call to action','call-to-action'],
  'social-proof': ['social proof','logos','trusted by'],
}

// Returns { type:'section', section:'pricing' } or { type:'global' }
export function classifyEdit(instruction) {
  const lower = instruction.toLowerCase()
  for (const [section, kws] of Object.entries(SECTION_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return { type: 'section', section }
  }
  return { type: 'global' }
}

// Extract the outerHTML of a data-section="X" element from an HTML string.
// Uses DOMParser (browser-native, no deps). Returns null if not found.
export function extractSection(html, section) {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const el = doc.querySelector(`[data-section="${section}"]`)
  return el ? el.outerHTML : null
}

// Replace the data-section="X" element in html with newFragment (string).
// Falls back to returning the original html unchanged if the section isn't found.
export function replaceSection(html, section, newFragment) {
  const current = extractSection(html, section)
  if (!current) return html
  return html.replace(current, newFragment)
}
