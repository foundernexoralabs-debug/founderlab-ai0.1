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

function localSvgDataUrls(files) {
  return new Map((files || [])
    .filter((file) => file?.path?.startsWith('assets/') && file.path.toLowerCase().endsWith('.svg'))
    .map((file) => [file.path, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content).replace(/'/g, '%27')}`]))
}

export function inlineLocalSvgReferences(source, files) {
  const assets = localSvgDataUrls(files)
  if (!assets.size) return source
  return String(source || '')
    .replace(/\b(src|href)=(['"])(assets\/[a-z0-9][a-z0-9._/-]*\.svg)\2/gi, (match, attribute, quote, path) => {
      const dataUrl = assets.get(path)
      return dataUrl ? `${attribute}=${quote}${dataUrl}${quote}` : match
    })
    .replace(/\burl\(\s*(['"]?)(assets\/[a-z0-9][a-z0-9._/-]*\.svg)\1\s*\)/gi, (match, quote, path) => {
      const dataUrl = assets.get(path)
      return dataUrl ? `url("${dataUrl}")` : match
    })
}

function safePreviewBridge() {
  return `
    (function () {
      var runtimeFailed = false;
      var notify = function (type, detail) {
        window.parent.postMessage({ source: 'founderlab-builder-preview', type: type, detail: detail || null }, '*');
      };
      var runtimeError = function () {
        runtimeFailed = true;
        notify('runtime-error', { code: 'PREVIEW_RUNTIME_ERROR' });
      };
      window.addEventListener('error', runtimeError);
      window.addEventListener('unhandledrejection', runtimeError);
      document.addEventListener('click', function (event) {
        var link = event.target.closest && event.target.closest('[data-builder-path]');
        if (!link) return;
        event.preventDefault();
        notify('navigate', { path: link.getAttribute('data-builder-path') });
      });
      window.addEventListener('load', function () {
        window.setTimeout(function () {
          if (!runtimeFailed) notify('ready', null);
        }, 0);
      });
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
  const body = routeLocalLinks(inlineLocalSvgReferences(bodyOf(index.content), validation.files))
  const previewCss = inlineLocalSvgReferences(css, validation.files)
  const srcDoc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${BUILDER_PREVIEW_CSP}"><title>${escapeHtml(titleOf(index.content))}</title>
<style>${escapeForScript(previewCss)}</style></head><body>${body}
<script>${safePreviewBridge()}<\/script><script>${escapeForScript(script)}<\/script></body></html>`
  return { ok: true, validation, srcDoc }
}

export function isSafeBuilderPreviewMessage(event, iframeWindow) {
  const data = event?.data
  return event?.source === iframeWindow
    && data?.source === 'founderlab-builder-preview'
    && ['ready', 'runtime-error', 'navigate'].includes(data?.type)
}
