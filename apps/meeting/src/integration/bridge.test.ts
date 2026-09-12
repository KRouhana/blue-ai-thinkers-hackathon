import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePreview, previewUrl } from './bridge';

const origin = 'http://localhost:5174';
const frame = {} as Window;
const revision = { source: 2, config: 3 };
const rendered = { type: 'fork.preview.rendered', workspaceId: 'workspace-a', revision };
const decode = (data: unknown, source: MessageEventSource | null = frame, eventOrigin = origin) => decodePreview({ data, source, origin: eventOrigin }, frame, origin, 'workspace-a', revision);

test('preview URLs require the exact configured HTTP origin and no embedded credentials', () => {
  assert.equal(previewUrl(`${origin}/demo?q=1#section`, origin), `${origin}/demo?q=1#section`);
  for (const value of [null, '', '/relative', 'javascript:alert(1)', 'data:text/html,hello', 'http://localhost:51740', 'http://127.0.0.1:5174', 'https://localhost:5174', 'http://user:password@localhost:5174', 'http://localhost:5174.evil.test']) {
    assert.equal(previewUrl(value, origin), null, String(value));
  }
});

test('bridge requires iframe source, exact origin, workspace and both revision numbers', () => {
  assert.deepEqual(decode(rendered), rendered);
  assert.equal(decode(rendered, {} as Window), null);
  assert.equal(decode(rendered, null), null);
  assert.equal(decode(rendered, frame, 'http://localhost:51740'), null);
  assert.equal(decodePreview({ data: rendered, source: frame, origin }, null, origin, 'workspace-a', revision), null);
  for (const data of [
    { ...rendered, workspaceId: 'workspace-b' },
    { ...rendered, revision: { source: 1, config: 3 } },
    { ...rendered, revision: { source: 2, config: 4 } },
    { ...rendered, revision: { source: -1, config: 3 } },
    { ...rendered, revision: { source: 2.5, config: 3 } },
    JSON.stringify(rendered), null, { ...rendered, type: 'arbitrary-command' },
  ]) assert.equal(decode(data), null);
});

test('preview context enforces payload bounds and geometry validity', () => {
  const element = { id: 'button-a', role: 'button', label: 'Start trial', visible: true, box: { x: 0, y: 10, width: 100, height: 40 }, editable: ['size'] };
  const context = { ...rendered, type: 'fork.preview.context', route: '/', viewport: { width: 1200, height: 800 }, elements: [element], focusId: null, hover: null, selection: null };
  assert.deepEqual(decode(context), context);
  for (const data of [
    { ...context, elements: Array(201).fill(element) },
    { ...context, elements: [{ ...element, label: 'x'.repeat(501) }] },
    { ...context, elements: [{ ...element, box: { ...element.box, x: Infinity } }] },
    { ...context, elements: [{ ...element, box: { ...element.box, width: -1 } }] },
    { ...context, elements: [{ ...element, editable: ['execute_code'] }] },
    { ...context, viewport: { width: 0, height: 800 } },
    { ...rendered, type: 'fork.preview.error', message: 'x'.repeat(1001) },
  ]) assert.equal(decode(data), null);
});
