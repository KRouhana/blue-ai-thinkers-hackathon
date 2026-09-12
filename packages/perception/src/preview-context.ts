import type { ObservationSink, PreviewContextObservation, PreviewElement } from './contracts.js';
import { createObservationId, iso } from './ids.js';
import type { PreviewCollectorOptions } from './types.js';

export const PREVIEW_BRIDGE_VERSION = 1;
export const PREVIEW_CONTEXT_MESSAGE = 'fork.preview.context';

export interface PreviewBridgeMessage {
  version: typeof PREVIEW_BRIDGE_VERSION;
  type: typeof PREVIEW_CONTEXT_MESSAGE;
  observation: PreviewContextObservation;
}

/**
 * Collects only annotated, currently visible preview evidence. It does not
 * synthesize a target, read input values, or write to the document.
 */
export class PreviewContextCollector {
  private readonly root: HTMLElement;
  private readonly maxElements: number;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private focusId: string | null = null;
  private hover: { elementId: string; at: string } | null = null;
  private selection: { elementId: string; at: string } | null = null;
  private observer: MutationObserver | null = null;
  private scheduled = false;
  private onChange: ((observation: PreviewContextObservation) => void) | null = null;

  constructor(private readonly options: PreviewCollectorOptions) {
    this.root = options.root ?? document.body;
    this.maxElements = Math.min(Math.max(options.maxElements ?? 40, 1), 100);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => createObservationId('ctx'));
  }

  snapshot(): PreviewContextObservation {
    const elements = this.collectElements();
    const validIds = new Set(elements.map((element) => element.id));
    const focusId = this.focusId && validIds.has(this.focusId) ? this.focusId : null;
    const hover = this.hover && validIds.has(this.hover.elementId) ? this.hover : null;
    const selection = this.selection && validIds.has(this.selection.elementId) ? this.selection : null;
    return {
      id: this.createId(),
      kind: 'preview_context',
      sessionId: this.options.sessionId,
      captureEpoch: this.options.captureEpoch(),
      capturedAt: iso(this.now),
      version: 1,
      workspaceId: this.options.workspaceId,
      revision: this.options.revision(),
      // Query strings and hashes can carry credentials; route evidence is path only.
      route: boundedPath(window.location.pathname),
      viewport: { width: bounded(window.innerWidth, 0, 10_000), height: bounded(window.innerHeight, 0, 10_000) },
      elements,
      focusId,
      hover,
      selection,
    };
  }

  /** Only the host/UI may call this explicit evidence setter. */
  setSelection(elementId: string | null): void {
    const known = elementId ? this.elementById(elementId) : null;
    this.selection = known && elementId ? { elementId, at: iso(this.now) } : null;
    this.schedule();
  }

  /** Starts passive collection. No mutation or action is ever dispatched. */
  start(onChange: (observation: PreviewContextObservation) => void): () => void {
    this.stop();
    this.onChange = onChange;
    this.root.addEventListener('focusin', this.onFocus, true);
    this.root.addEventListener('pointerover', this.onHover, true);
    window.addEventListener('popstate', this.schedule);
    window.addEventListener('hashchange', this.schedule);
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: [
      'data-fork-id', 'data-fork-section', 'aria-label', 'aria-hidden', 'hidden', 'role', 'style', 'class', 'disabled',
    ] });
    this.schedule();
    return () => this.stop();
  }

  stop(): void {
    this.root.removeEventListener('focusin', this.onFocus, true);
    this.root.removeEventListener('pointerover', this.onHover, true);
    window.removeEventListener('popstate', this.schedule);
    window.removeEventListener('hashchange', this.schedule);
    this.observer?.disconnect();
    this.observer = null;
    this.onChange = null;
    this.scheduled = false;
  }

  private readonly onFocus = (event: Event): void => {
    const element = annotatedAncestor(event.target);
    this.focusId = element?.dataset.forkId ?? null;
    this.schedule();
  };

  private readonly onHover = (event: Event): void => {
    const element = annotatedAncestor(event.target);
    this.hover = element?.dataset.forkId ? { elementId: element.dataset.forkId, at: iso(this.now) } : null;
    this.schedule();
  };

  private readonly schedule = (): void => {
    if (this.scheduled || !this.onChange) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      if (this.onChange) this.onChange(this.snapshot());
    }, 100);
  };

  private collectElements(): PreviewElement[] {
    const elements: PreviewElement[] = [];
    for (const candidate of this.root.querySelectorAll<HTMLElement>('[data-fork-id]')) {
      if (elements.length >= this.maxElements) break;
      const element = toPreviewElement(candidate);
      if (element) elements.push(element);
    }
    return elements;
  }

  private elementById(id: string): HTMLElement | null {
    return [...this.root.querySelectorAll<HTMLElement>('[data-fork-id]')]
      .find((element) => element.dataset.forkId === id) ?? null;
  }
}

export async function emitPreviewContext(
  collector: PreviewContextCollector,
  sink: ObservationSink,
): Promise<PreviewContextObservation> {
  const observation = collector.snapshot();
  await sink([observation]);
  return observation;
}

export function postPreviewContext(target: Window, targetOrigin: string, observation: PreviewContextObservation): void {
  target.postMessage({
    version: PREVIEW_BRIDGE_VERSION,
    type: PREVIEW_CONTEXT_MESSAGE,
    observation,
  } satisfies PreviewBridgeMessage, targetOrigin);
}

export interface PreviewContextBridgeOptions {
  origin: string;
  sink: ObservationSink;
  /** Provide the iframe's contentWindow to reject messages from unrelated frames. */
  source?: MessageEventSource | null;
  window?: Window;
}

/** Strict, versioned host-side receiver for an untrusted preview iframe. */
export function createPreviewContextBridge(options: PreviewContextBridgeOptions): { dispose(): void; handle(event: MessageEvent<unknown>): void } {
  const hostWindow = options.window ?? window;
  const handle = (event: MessageEvent<unknown>): void => {
    if (event.origin !== options.origin) return;
    if (options.source !== undefined && event.source !== options.source) return;
    if (!isPreviewBridgeMessage(event.data)) return;
    void options.sink([event.data.observation]);
  };
  hostWindow.addEventListener('message', handle as EventListener);
  return {
    dispose: () => hostWindow.removeEventListener('message', handle as EventListener),
    handle,
  };
}

function toPreviewElement(element: HTMLElement): PreviewElement | null {
  const id = element.dataset.forkId;
  if (!id || !safeIdentifier(id) || isExcluded(element) || !isVisible(element)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const tag = element.tagName.toLowerCase();
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
  const ariaLabel = safeText(element.getAttribute('aria-label'));
  // Form-control labels are ARIA-only: never read current values, placeholders, or option text.
  const label = isField ? ariaLabel : ariaLabel || safeText(element.textContent) || tag;
  const section = sectionFor(element);
  return {
    id,
    role: safeRole(element.getAttribute('role'), tag),
    label,
    ...(section ? { section } : {}),
    visible: true,
    box: {
      x: bounded(Math.round(rect.x), -10_000, 10_000),
      y: bounded(Math.round(rect.y), -10_000, 10_000),
      width: bounded(Math.round(rect.width), 0, 10_000),
      height: bounded(Math.round(rect.height), 0, 10_000),
    },
    editable: editableProperties(element),
  };
}

function isExcluded(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' && ['hidden', 'password'].includes((element as HTMLInputElement).type);
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
}

function sectionFor(element: HTMLElement): string | null {
  const section = element.closest<HTMLElement>('[data-fork-section], section, main');
  if (!section) return null;
  return safeText(section.dataset.forkSection) || safeText(section.querySelector('h1,h2,h3')?.textContent);
}

function editableProperties(element: HTMLElement): PreviewElement['editable'] {
  const raw = element.dataset.forkEditable;
  if (!raw) return [];
  const allowed = new Set(['size', 'background', 'label', 'radius', 'visible']);
  return raw.split(',').map((value) => value.trim()).filter((value): value is PreviewElement['editable'][number] => allowed.has(value));
}

function safeRole(role: string | null, tag: string): string {
  const candidate = role?.trim().toLowerCase();
  return candidate && /^[a-z][a-z0-9_-]{0,39}$/.test(candidate) ? candidate : tag;
}

function safeIdentifier(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value);
}

function safeText(value: string | null | undefined): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  // Never forward likely credentials, JWTs, bearer values, or long secret-like strings as evidence.
  if (/\b(bearer|token|api[_ -]?key|secret|password)\b/i.test(normalized)) return '[redacted]';
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(normalized)) return '[redacted]';
  return normalized;
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function boundedPath(path: string): string {
  return path.startsWith('/') ? path.slice(0, 256) || '/' : '/';
}

function annotatedAncestor(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>('[data-fork-id]') : null;
}

function isPreviewBridgeMessage(value: unknown): value is PreviewBridgeMessage {
  if (!isRecord(value) || value.version !== PREVIEW_BRIDGE_VERSION || value.type !== PREVIEW_CONTEXT_MESSAGE) return false;
  const observation = value.observation;
  if (!isRecord(observation) || observation.kind !== 'preview_context') return false;
  if (!validString(observation.id, 120) || !validString(observation.sessionId, 120) || !validString(observation.captureEpoch, 120)) return false;
  if (!validString(observation.workspaceId, 120) || !validString(observation.capturedAt, 64) || !validString(observation.route, 256)) return false;
  if (!Array.isArray(observation.elements) || observation.elements.length > 100) return false;
  return observation.elements.every((element) => isRecord(element) && validString(element.id, 80) && validString(element.role, 40) && validString(element.label, 160));
}

function validString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
