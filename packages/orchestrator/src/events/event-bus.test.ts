import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSqliteStore } from '@fork/state';
import { EventBus } from './event-bus';
import { fixedClock } from '../clock';

test('publish persists with sequence and fans out to session subscribers only', () => {
  const store = openSqliteStore(':memory:');
  const bus = new EventBus(store, fixedClock('2026-09-12T15:00:00.000Z'));
  const seen: number[] = [];
  const off = bus.subscribe('s1', (e) => { seen.push(e.sequence); });
  bus.subscribe('s2', () => { throw new Error('wrong session'); });
  const e = bus.publish('s1', { kind: 'status', message: 'hi' });
  assert.equal(e.sequence, 1);
  assert.deepEqual(seen, [1]);
  off();
  bus.publish('s1', { kind: 'status', message: 'again' });
  assert.deepEqual(seen, [1]);
  assert.equal(store.lastEventSequence('s1'), 2);
  store.close();
});

test('a throwing subscriber does not break other subscribers', () => {
  const store = openSqliteStore(':memory:');
  const bus = new EventBus(store, fixedClock('2026-09-12T15:00:00.000Z'));
  let ok = 0;
  bus.subscribe('s1', () => { throw new Error('bad listener'); });
  bus.subscribe('s1', () => { ok += 1; });
  bus.publish('s1', { kind: 'status', message: 'x' });
  assert.equal(ok, 1);
  store.close();
});
