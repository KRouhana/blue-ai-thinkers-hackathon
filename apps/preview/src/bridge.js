// Preview-only transport. A may publish its collector's bounded snapshot through forkPreview.publishContext.
let metadata;
let lastContext = '';
let externalCollector = false;
let hover = null;
const scalar = value => typeof value === 'string' ? value.slice(0, 200) : '';
const publish = (type, payload = {}) => {
  if (!metadata || window.parent === window) return;
  window.parent.postMessage({ type, version: 1, ...metadata, payload }, metadata.hostOrigin);
};
const finite = value => Number.isFinite(value) ? Math.max(-100000, Math.min(100000, value)) : 0;
function elementsSnapshot(elements) {
  return elements.slice(0, 100).filter(e => /^[\w-]{1,80}$/.test(e.id)).map(e => ({
    id: e.id, role: scalar(e.role), label: scalar(e.label), visible: e.visible === true,
    editable: Array.isArray(e.editable) ? e.editable.filter(p => ['size', 'background', 'label', 'radius', 'visible'].includes(p)) : [],
    box: { x: finite(e.box?.x), y: finite(e.box?.y), width: finite(e.box?.width), height: finite(e.box?.height) },
  }));
}
function publishContext(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.elements)) return;
  const payload = { route: location.pathname, viewport: { width: innerWidth, height: innerHeight },
    elements: elementsSnapshot(snapshot.elements), focusId: scalar(snapshot.focusId) || null,
    hover: snapshot.hover && /^[\w-]{1,80}$/.test(snapshot.hover.elementId) ? { elementId: snapshot.hover.elementId, at: scalar(snapshot.hover.at) } : null,
    selection: snapshot.selection && /^[\w-]{1,80}$/.test(snapshot.selection.elementId) ? { elementId: snapshot.selection.elementId, at: scalar(snapshot.selection.at) } : null };
  const signature = JSON.stringify({ ...metadata, payload });
  if (signature !== lastContext) { lastContext = signature; publish('fork.preview.context', payload); }
}
function registeredContext() {
  if (externalCollector) return;
  const elements = [...document.querySelectorAll('[data-fork-id]')].slice(0, 100).filter(el => !el.matches('input,textarea,[contenteditable="true"]')).map(el => {
    const box = el.getBoundingClientRect();
    return { id: el.dataset.forkId, role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: el.getAttribute('aria-label') || el.textContent?.trim(),
      visible: box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
      box, editable: (el.dataset.forkEditable || '').split(',') };
  });
  publishContext({ elements, focusId: document.activeElement?.getAttribute('data-fork-id'), hover });
}
async function refresh() {
  try {
    const response = await fetch('/__fork/meta', { cache: 'no-store' });
    if (!response.ok) return;
    const next = await response.json();
    if (!next || typeof next.hostOrigin !== 'string' || !next.revision || typeof next.instanceId !== 'string') return;
    const changed = JSON.stringify(next) !== JSON.stringify(metadata);
    metadata = next;
    if (changed) requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__forkRendered = { ...metadata, route: location.pathname };
      publish('fork.preview.rendered', { route: location.pathname });
      window.dispatchEvent(new CustomEvent('fork.preview.revision', { detail: { ...metadata } }));
      registeredContext();
    }));
  } catch { /* Host owns readiness timeout; no invented ready event. */ }
}
window.forkPreview = Object.freeze({ publishContext(snapshot) { externalCollector = true; publishContext(snapshot); } });
window.dispatchEvent(new Event('fork.preview.available'));
window.addEventListener('message', event => {
  if (!metadata || event.source !== window.parent || event.origin !== metadata.hostOrigin) return;
  if (event.data?.type !== 'fork.preview.load-config' || event.data.workspaceId !== metadata.workspaceId) return;
  // A host message is a refresh hint, never authority to mutate configuration.
  void refresh();
});
window.addEventListener('error', event => publish('fork.preview.error', { message: scalar(event.message) }));
window.addEventListener('unhandledrejection', () => publish('fork.preview.error', { message: 'Unhandled application promise rejection' }));
window.addEventListener('pointerover', event => {
  const el = event.target instanceof Element ? event.target.closest('[data-fork-id]') : null;
  hover = el ? { elementId: scalar(el.getAttribute('data-fork-id')), at: new Date().toISOString() } : null;
  registeredContext();
});
window.addEventListener('focusin', registeredContext);
window.addEventListener('resize', registeredContext);
setInterval(() => { void refresh(); registeredContext(); }, 1000);
void refresh();
