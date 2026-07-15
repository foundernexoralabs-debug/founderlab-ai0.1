import { BUILDER_ENTRY_FILE } from './builderProjectSchema.js'
import { validateBuilderFiles } from './builderValidation.js'

export const BUILDER_PREVIEW_SANDBOX = 'allow-scripts'
export const BUILDER_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

function escapeForScript(value) {
  return String(value || '').replace(/<\/script/gi, '<\\/script')
}

function bodyOf(html) {
  const match = String(html || '').match(/<body[^>]*>([\s\S]*)<\/body>/i)
  if (match) return match[1]
  return String(html || '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
}

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1].trim() : 'FounderLab Builder preview'
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function routeLocalLinks(html) {
  return html.replace(/\bhref=(['"])((?:pages\/)?[a-z0-9][a-z0-9._-]*\.html)\1/gi, 'href="#" data-builder-path="$2"')
}

function safePreviewBridge() {
  return `
    (function () {
      var notify = function (type, detail) {
        window.parent.postMessage({ source: 'founderlab-builder-preview', type: type, detail: detail || null }, '*');
      };
      window.addEventListener('error', function () { notify('runtime-error', { code: 'PREVIEW_RUNTIME_ERROR' }); });
      window.addEventListener('unhandledrejection', function () { notify('runtime-error', { code: 'PREVIEW_RUNTIME_ERROR' }); });
      document.addEventListener('click', function (event) {
        var link = event.target.closest && event.target.closest('[data-builder-path]');
        if (!link) return;
        event.preventDefault();
        notify('navigate', { path: link.getAttribute('data-builder-path') });
      });
      notify('ready', null);
    }());`
}

export function buildBuilderPreviewDocument(files, { entryFile = BUILDER_ENTRY_FILE } = {}) {
  const validation = validateBuilderFiles(files)
  if (!validation.valid) return { ok: false, validation, srcDoc: '' }
  const index = validation.files.find((file) => file.path === entryFile) || validation.files.find((file) => file.path === BUILDER_ENTRY_FILE)
  if (!index?.path.endsWith('.html')) {
    return { ok: false, validation: { ...validation, valid: false, issues: [...validation.issues, { code: 'PREVIEW_PAGE_INVALID', message: 'Choose a valid HTML page to preview.', path: entryFile, severity: 'error' }] }, srcDoc: '' }
  }
  const css = validation.files.find((file) => file.path === 'styles.css')?.content || ''
  const script = validation.files.find((file) => file.path === 'app.js')?.content || ''
  const srcDoc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${BUILDER_PREVIEW_CSP}"><title>${escapeHtml(titleOf(index.content))}</title>
<style>${escapeForScript(css)}</style></head><body>${routeLocalLinks(bodyOf(index.content))}
<script>${safePreviewBridge()}<\/script><script>${escapeForScript(script)}<\/script></body></html>`
  return { ok: true, validation, srcDoc }
}

export function isSafeBuilderPreviewMessage(event, iframeWindow) {
  const data = event?.data
  return event?.source === iframeWindow
    && data?.source === 'founderlab-builder-preview'
    && ['ready', 'runtime-error', 'navigate'].includes(data?.type)
}
