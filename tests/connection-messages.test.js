import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url), 'utf8'));
function setup(firstMessageDelayMs) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const definition = {
    version: 1,
    id: 'generic-first-message',
    contact: { id: 'generic', name: 'Generic', nickname: 'Generic' },
    player: { nickname: 'Player' },
    start: 'start',
    nodes: {
      start: {
        messages: [{ speaker: 'contact', text: 'hello', delayMs: 1000, typingMs: 500 }],
        end: true,
      },
    },
  };
  const thread = new ConversationThread('generic', progression, () => [definition]);
  const config = {
    defaultFirstMessageDelayMs: 3000,
    events: {
      generic: {
        contactId: 'generic',
        dialogueId: definition.id,
        threadId: 'generic',
        ...(firstMessageDelayMs === undefined ? {} : { firstMessageDelayMs }),
      },
    },
  };
  const scheduler = new ConnectionMessages(progression, { [definition.id]: definition }, config,
    (id) => id === 'generic' ? thread : null);
  return { values, storage, progression, definition, thread, scheduler };
}

test('connection first-message scheduling uses the global three-second default and is idempotent', () => {
  const { progression, definition, thread, scheduler } = setup();
  assert.equal(scheduler.connect('generic', 10_000), true);
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, 13_000);
  assert.equal(scheduler.connect('generic', 11_000), true);
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, 13_000);
  assert.deepEqual(thread.receive(12_999), []);
  assert.deepEqual(thread.receive(13_000), [definition]);
  assert.deepEqual(thread.receive(13_000), []);
  assert.equal(thread.state.history.filter((entry) => entry.text === 'hello').length, 1);
});

test('connection-specific delay overrides the default and survives a save reload', () => {
  const original = setup(5000);
  assert.equal(original.scheduler.connect('generic', 20_000), true);
  assert.equal(original.progression.data.dialogues[original.definition.id].receiveDueAt, 25_000);

  const progression = new Progression(story, original.storage);
  const thread = new ConversationThread('generic', progression, () => [original.definition]);
  const scheduler = new ConnectionMessages(
    progression,
    { [original.definition.id]: original.definition },
    { ...original.scheduler.config, events: { ...original.scheduler.config.events } },
    (id) => id === 'generic' ? thread : null,
  );
  scheduler.restorePending();
  assert.equal(progression.data.dialogues[original.definition.id].receiveDueAt, 25_000);
  assert.deepEqual(thread.receive(24_999), []);
  assert.deepEqual(thread.receive(25_000), [original.definition]);
  assert.deepEqual(thread.receive(25_000), []);
});

test('connections without a configured first-message event do not schedule messages', () => {
  const { progression, thread } = setup();
  let lookups = 0;
  const scheduler = new ConnectionMessages(progression, {}, {
    defaultFirstMessageDelayMs: 3000,
    events: {},
  }, () => { lookups++; return thread; });
  assert.equal(scheduler.connect('generic', 30_000), false);
  assert.equal(lookups, 0);
  assert.equal(Object.keys(progression.data.pendingConnectionMessages).length, 0);
  assert.equal(progression.data.dialogues['generic-first-message'], undefined);
});

test('New Game retires a pending connection deadline from the previous run', () => {
  const { progression, definition, scheduler } = setup();
  const previousRun = progression.data.runId;
  scheduler.connect('generic', 50_000);
  assert.equal(progression.data.pendingConnectionMessages.generic.dueAt, 53_000);

  progression.newGame();
  assert.notEqual(progression.data.runId, previousRun);
  assert.deepEqual(progression.data.pendingConnectionMessages, {});
  scheduler.restorePending();
  assert.equal(progression.data.dialogues[definition.id], undefined);
});
