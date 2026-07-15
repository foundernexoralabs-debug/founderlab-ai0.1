// Compiles a set of generated Next.js App Router files (real, separate
// components/pages) into a single runnable in-browser preview: real React
// rendering, real client-side navigation between all routes, no reload,
// no "loading forever". This is a preview harness only — the exported/
// pushed project is the real separate-file Next.js project, unaffected.
import { REQUIRED_PAGES } from './nextProjectSpec'

const CDN = {
  react:    'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  babel:    'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js',
}

// Strip 'use client' directives, all import statements, and convert
// `export default function X` / `export default X` / `export function X` /
// `export const X` into plain top-level declarations so every component
// becomes a bare identifier in one shared scope (no real module resolution
// needed in-browser).
function stripToPlainScope(src) {
  return src
    .replace(/^\s*['"]use client['"];?\s*$/m, '')
    .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+function\s+/m, 'function ')
    .replace(/^export\s+default\s+/m, 'const __default__ = ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
}

function fileToComponentName(path) {
  const base = path.split('/').pop().replace(/\.(tsx|ts|jsx|js)$/, '')
  return base === 'page' ? null : base
}

export function isPreviewableProject(files) {
  return files.some(f => /app\/page\.(tsx|jsx)$/.test(f.path))
}

export function buildProjectPreview(files) {
  const css = files.filter(f => /\.css$/i.test(f.path)).map(f => f.content).join('\n')
  const codeFiles = files.filter(f => /\.(tsx|jsx|ts|js)$/i.test(f.path) && !/\.d\.ts$/.test(f.path))

  const components = codeFiles.filter(f => f.path.startsWith('components/'))
  const pages = REQUIRED_PAGES
    .map(p => ({ ...p, file: codeFiles.find(f => f.path === p.file) }))
    .filter(p => p.file)

  const componentSrc = components.map(f => stripToPlainScope(f.content)).join('\n\n')
  const pageSrc = pages.map(p => stripToPlainScope(p.file.content)).join('\n\n')

  const routeSwitch = pages.map(p =>
    `    if (route === ${JSON.stringify(p.route)}) return React.createElement(${p.name});`
  ).join('\n')

  const bundleSource = `
// ── Preview shims (Next.js APIs simulated for in-browser preview) ──
const { useState, useEffect, useRef, useCallback, useMemo } = React;

function Link({ href, children, className, ...rest }) {
  return React.createElement('a', {
    href, className,
    onClick: (e) => { e.preventDefault(); if (window.__flSetRoute) window.__flSetRoute(href) },
    ...rest,
  }, children);
}
function Image({ src, alt, className, ...rest }) {
  return React.createElement('img', { src, alt: alt || '', className, ...rest });
}
function useRouter() { return { push: (href) => window.__flSetRoute && window.__flSetRoute(href) } }
function usePathname() { return window.__flCurrentRoute || '/' }

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (this.state.err) {
      return React.createElement('div', { style: { padding: 60, textAlign: 'center', fontFamily: 'Inter, sans-serif' } },
        React.createElement('p', { style: { fontSize: 32, marginBottom: 12 } }, '⚠️'),
        React.createElement('p', { style: { color: '#eeeef8', fontSize: 16, marginBottom: 8 } }, 'This section hit an error while rendering.'),
        React.createElement('p', { style: { color: '#8888b0', fontSize: 13 } }, String(this.state.err.message || this.state.err))
      );
    }
    return this.props.children;
  }
}

// ── Shared components ──
${componentSrc}

// ── Pages ──
${pageSrc}

// ── Router harness ──
function AppRouter() {
  const [route, setRoute] = useState(window.__flCurrentRoute || '/');
  useEffect(() => {
    window.__flSetRoute = (r) => { window.__flCurrentRoute = r; setRoute(r); window.scrollTo(0,0) };
    return () => { window.__flSetRoute = null };
  }, []);
  function renderPage() {
${routeSwitch}
    return React.createElement('div', { style:{padding:60,textAlign:'center',color:'#8888b0'} }, '404 — Page not found');
  }
  return React.createElement(React.Fragment, null,
    typeof Navbar !== 'undefined' ? React.createElement(Navbar, { currentRoute: route }) : null,
    React.createElement(ErrorBoundary, null, renderPage()),
    typeof Footer !== 'undefined' ? React.createElement(Footer, null) : null
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppRouter));
`.trim()

  const b64 = btoa(unescape(encodeURIComponent(bundleSource)))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script src="${CDN.react}"></script>
<script src="${CDN.reactDom}"></script>
<script src="${CDN.babel}"></script>
<style>
  html,body{margin:0;font-family:'Inter',sans-serif;background:#09090f;}
  .fl-skeleton{position:relative;overflow:hidden;background:rgba(255,255,255,.06);}
  .fl-skeleton::after{content:'';position:absolute;inset:0;transform:translateX(-100%);
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);
    animation:flShimmer 1.5s infinite;}
  @keyframes flShimmer{100%{transform:translateX(100%)}}
  ${css}
</style>
</head>
<body>
<div id="root"><div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#8888b0;font-family:Inter,sans-serif;">Loading preview…</div></div>
<script id="fl-src" type="text/plain">${b64}</script>
<script>
  window.addEventListener('load', function () {
    try {
      var b64 = document.getElementById('fl-src').textContent;
      var source = decodeURIComponent(escape(atob(b64)));
      var out = Babel.transform(source, { presets: [['react',{runtime:'classic'}], 'typescript'], filename: 'bundle.tsx' }).code;
      var executable = document.createElement('script');
      executable.textContent = out;
      document.body.appendChild(executable);
    } catch (e) {
      var root = document.getElementById('root');
      var errorBox = document.createElement('div');
      errorBox.style.cssText = 'padding:60px;text-align:center;font-family:Inter,sans-serif;color:#eeeef8;';
      var icon = document.createElement('p');
      icon.style.cssText = 'font-size:32px;margin-bottom:12px;';
      icon.textContent = '⚠️';
      var title = document.createElement('p');
      title.style.cssText = 'margin-bottom:8px;';
      title.textContent = 'Preview could not render.';
      var detail = document.createElement('p');
      detail.style.cssText = 'color:#8888b0;font-size:13px;';
      detail.textContent = String(e.message || e);
      errorBox.append(icon, title, detail);
      root.replaceChildren(errorBox);
    }
  });
</script>
</body>
</html>`
}
