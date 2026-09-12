import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCompanyDocs, retrieveCompanyNotes } from './company-docs';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/company', import.meta.url));

test('loads every synthetic company note as labelled paragraphs', () => {
  const docs = loadCompanyDocs(FIXTURES);
  assert.ok(docs.length >= 6, `expected several paragraphs, got ${docs.length}`);
  assert.ok(docs.every((doc) => doc.path.startsWith('fixtures/company/')));
  assert.ok(docs.every((doc) => doc.fingerprint.length > 0));
});

test('retrieves the task-board note for an overdue-filter question', () => {
  const docs = loadCompanyDocs(FIXTURES);
  const notes = retrieveCompanyNotes(docs, 'We should filter overdue tasks using the example due dates', 2);
  assert.ok(notes.length >= 1);
  assert.match(notes[0]?.path ?? '', /task-board-constraints\.md/);
  assert.ok(notes.length <= 2);
});

test('retrieves the signup note when the signup button is the topic', () => {
  const docs = loadCompanyDocs(FIXTURES);
  const notes = retrieveCompanyNotes(docs, 'The Start trial button on the signup page is too small', 1);
  assert.match(notes[0]?.path ?? '', /signup-flow-notes\.md/);
});

test('an unrelated question retrieves nothing rather than a random paragraph', () => {
  const docs = loadCompanyDocs(FIXTURES);
  assert.deepEqual(retrieveCompanyNotes(docs, 'zzzqqq wibblefrotz', 2), []);
});

test('a missing directory yields no notes instead of throwing', () => {
  assert.deepEqual(loadCompanyDocs('/nonexistent/fork/company/docs'), []);
});
