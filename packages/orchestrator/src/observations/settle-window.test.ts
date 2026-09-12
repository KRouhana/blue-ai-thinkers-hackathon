import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettleWindow } from './settle-window';

const tick = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

test('coalesces touches into one settle call after the window', async () => {
  const calls: string[] = [];
  const window = new SettleWindow(10, async (id) => { calls.push(id); });
  window.touch('s1');
  window.touch('s1');
  window.touch('s1');
  await tick(40);
  assert.deepEqual(calls, ['s1']);
  window.dispose();
});

test('flush runs immediately and cancels the pending timer', async () => {
  const calls: string[] = [];
  const window = new SettleWindow(50, async (id) => { calls.push(id); });
  window.touch('s1');
  await window.flush('s1');
  await tick(80);
  assert.deepEqual(calls, ['s1']);
  window.dispose();
});

test('settle errors are reported, not thrown from the timer', async () => {
  const errors: string[] = [];
  const window = new SettleWindow(5, async () => { throw new Error('boom'); }, (error) => errors.push(String(error)));
  window.touch('s1');
  await tick(30);
  assert.match(errors[0] ?? '', /boom/);
  window.dispose();
});

test('separate sessions settle independently', async () => {
  const calls: string[] = [];
  const window = new SettleWindow(5, async (id) => { calls.push(id); });
  window.touch('s1');
  window.touch('s2');
  await tick(30);
  assert.deepEqual([...calls].sort(), ['s1', 's2']);
  window.dispose();
});
