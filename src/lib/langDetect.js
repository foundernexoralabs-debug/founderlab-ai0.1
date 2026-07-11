// Lightweight heuristic language/framework detector — no external deps.
// Scores every candidate language against the given text and returns the best match.

const RULES = [
  { lang: 'TypeScript', re: [/:\s*(string|number|boolean|any|void|unknown)\b/, /interface\s+\w+/, /^\s*type\s+\w+\s*=/m, /<.+>\(.*\)\s*:\s*\w+/], weight: 3 },
  { lang: 'React',      re: [/import\s+React/, /from\s+['"]react['"]/, /useState\(/, /useEffect\(/, /<[A-Z]\w*[\s/>]/], weight: 3 },
  { lang: 'Python',     re: [/^\s*def\s+\w+\(.*\):/m, /^\s*import\s+\w+/m, /^\s*from\s+\w+\s+import/m, /print\(/, /^\s*class\s+\w+.*:/m, /self\./], weight: 2 },
  { lang: 'HTML/CSS',   re: [/<!DOCTYPE html>/i, /<html[\s>]/i, /<div[\s>]/, /^\s*\.[\w-]+\s*\{/m, /^\s*#[\w-]+\s*\{/m], weight: 2 },
  { lang: 'Rust',       re: [/fn\s+main\s*\(/, /let\s+mut\s+/, /^\s*use\s+std::/m, /impl\s+\w+/, /println!\(/], weight: 3 },
  { lang: 'Go',         re: [/^\s*package\s+main/m, /func\s+main\s*\(/, /^\s*import\s*\(/m, /fmt\.Println/], weight: 3 },
  { lang: 'Swift',      re: [/^\s*import\s+(Foundation|UIKit|SwiftUI)/m, /\bfunc\s+\w+\(.*\)\s*->/, /\bvar\s+\w+:\s*\w+/, /\blet\s+\w+:\s*\w+/], weight: 2 },
  { lang: 'SQL',        re: [/\bSELECT\s+.+\s+FROM\b/i, /\bCREATE\s+TABLE\b/i, /\bINSERT\s+INTO\b/i, /\bWHERE\b/i], weight: 3 },
  { lang: 'Bash',       re: [/^#!\/bin\/(ba)?sh/, /^\s*if\s*\[\s/m, /\becho\s+/, /^\s*#.*\n.*\$\w+/m], weight: 2 },
  { lang: 'JavaScript', re: [/\bconst\s+\w+\s*=/, /\bfunction\s+\w+\(/, /=>\s*\{/, /\bconsole\.log\(/, /module\.exports/], weight: 1 },
]

export function detectLanguage(text) {
  if (!text || !text.trim()) return null
  let best = null
  let bestScore = 0
  for (const rule of RULES) {
    let score = 0
    for (const re of rule.re) if (re.test(text)) score += rule.weight
    if (score > bestScore) { bestScore = score; best = rule.lang }
  }
  return bestScore > 0 ? best : null
}

// Also inspect a natural-language description for explicit language mentions
export function detectFromDescription(text) {
  if (!text) return null
  const map = {
    'typescript': 'TypeScript', 'ts ': 'TypeScript',
    'react': 'React', 'jsx': 'React', 'next.js': 'React', 'nextjs': 'React',
    'python': 'Python', 'django': 'Python', 'flask': 'Python',
    'html': 'HTML/CSS', 'css': 'HTML/CSS', 'website': 'HTML/CSS', 'landing page': 'HTML/CSS',
    'rust': 'Rust', 'cargo': 'Rust',
    'golang': 'Go', ' go ': 'Go',
    'swift': 'Swift', 'swiftui': 'Swift', 'ios app': 'Swift',
    'sql': 'SQL', 'postgres': 'SQL', 'mysql': 'SQL', 'database query': 'SQL',
    'bash': 'Bash', 'shell script': 'Bash',
    'javascript': 'JavaScript', 'node.js': 'JavaScript', 'nodejs': 'JavaScript',
  }
  const lower = ' ' + text.toLowerCase() + ' '
  for (const [kw, lang] of Object.entries(map)) if (lower.includes(kw)) return lang
  return null
}
