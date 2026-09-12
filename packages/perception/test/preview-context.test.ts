import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPreviewContextBridge, PreviewContextCollector } from '../src/preview-context.js';
import { recordingSink } from '../src/fixtures.js';

test('collects bounded visible preview evidence without input values or secret-looking labels', () => {
  usingDom('<main data-fork-section="Checkout"><h1>Checkout</h1><button data-fork-id="buy" data-fork-editable="size,label">Buy now</button><input data-fork-id="password" type="password" value="do-not-leak" /><input data-fork-id="email" aria-label="Customer email" value="secret@example.test" /></main>', () => {
    const buy = document.querySelector<HTMLElement>('[data-fork-id="buy"]')!;
    const email = document.querySelector<HTMLElement>('[data-fork-id="email"]')!;
    Object.defineProperty(buy, 'getBoundingClientRect', { value: () => rect(10, 20, 120, 40) });
    Object.defineProperty(email, 'getBoundingClientRect', { value: () => rect(1, 1, 140, 24) });
    const collector = new PreviewContextCollector({
      sessionId: 's', workspaceId: 'w', captureEpoch: () => 'e', revision: () => ({ source: 1, config: 2 }), root: document.body,
    });
    collector.setSelection('buy');
    const snapshot = collector.snapshot();
    assert.equal(snapshot.route, '/preview');
    assert.equal(snapshot.elements.length, 2);
    assert.deepEqual(snapshot.elements.map((element) => element.id), ['buy', 'email']);
    assert.equal(snapshot.elements.find((element) => element.id === 'email')?.label, 'Customer email');
    assert.equal(JSON.stringify(snapshot).includes('secret@example.test'), false);
    assert.equal(snapshot.selection?.elementId, 'buy');
  });
});

test('bridge rejects invalid-origin context messages', async () => {
  await usingDom('<main><button data-fork-id="buy">Buy</button></main>', async () => {
    const button = document.querySelector<HTMLElement>('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', { value: () => rect(0, 0, 30, 20) });
    const collector = new PreviewContextCollector({ sessionId: 's', workspaceId: 'w', captureEpoch: () => 'e', revision: () => ({ source: 0, config: 0 }) });
    const { sink, observations } = recordingSink();
    const bridge = createPreviewContextBridge({ origin: 'https://preview.example', sink, window });
    bridge.handle({ origin: 'https://evil.example', data: { version: 1, type: 'fork.preview.context', observation: collector.snapshot() }, source: null } as unknown as MessageEvent);
    await Promise.resolve();
    assert.equal(observations.length, 0);
    bridge.dispose();
  });
});

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function usingDom<T>(body: string, run: () => T): T {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: 'https://preview.example/preview?token=nope' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  });
  try {
    return run();
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}
