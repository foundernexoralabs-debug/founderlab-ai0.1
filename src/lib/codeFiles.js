// Parses AI output that may contain one or more fenced code blocks, optionally
// preceded by a filename comment/header, into a normalised files[] array.
// Falls back to a single "main" file when no explicit filenames are present.

const EXT_BY_LANG = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
  python: 'py', py: 'py', html: 'html', css: 'css', rust: 'rs', rs: 'rs',
  go: 'go', swift: 'swift', sql: 'sql', bash: 'sh', sh: 'sh', json: 'json', yaml: 'yml', yml: 'yml',
}

export function parseFiles(raw, fallbackName = 'main', fallbackExt = 'txt') {
  if (!raw) return []
  const blocks = []
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g
  let m
  let lastIndex = 0
  while ((m = fenceRe.exec(raw)) !== null) {
    const lang = (m[1] || '').toLowerCase()
    const code = m[2].replace(/\n$/, '')
    // Look at the text immediately before this fence for a filename hint
    const before = raw.slice(lastIndex, m.index)
    const fnameMatch = before.match(/(?:^|\n)\s*(?:\/\/|#)?\s*(?:file|filename)?:?\s*([\w./-]+\.\w+)\s*$/i)
      || code.match(/^\s*(?:\/\/|#)\s*([\w./-]+\.\w+)\s*\n/)
    let path = fnameMatch ? fnameMatch[1] : null
    if (!path) {
      const ext = EXT_BY_LANG[lang] || fallbackExt
      path = blocks.length === 0 ? `${fallbackName}.${ext}` : `${fallbackName}-${blocks.length + 1}.${ext}`
    }
    blocks.push({ path, content: code, lang })
    lastIndex = fenceRe.lastIndex
  }
  if (blocks.length === 0 && raw.trim()) {
    blocks.push({ path: `${fallbackName}.${fallbackExt}`, content: raw.trim(), lang: '' })
  }
  return blocks
}

export function isPreviewable(files) {
  return files.some(f => /\.html?$/i.test(f.path))
}

export function buildPreviewDoc(files) {
  const htmlFile = files.find(f => /\.html?$/i.test(f.path))
  if (htmlFile) return htmlFile.content
  // No HTML file — try to assemble something minimal from JS/CSS
  const css = files.filter(f => /\.css$/i.test(f.path)).map(f => f.content).join('\n')
  const js  = files.filter(f => /\.(js|jsx)$/i.test(f.path)).map(f => f.content).join('\n')
  if (!css && !js) return null
  return `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`
}
