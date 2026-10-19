import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { OptionalConversations } from '../src/story/optional-conversations.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const definitions = Object.fromEntries(readdirSync(new URL('../src/dialogues/', import.meta.url))
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const dialogue = read(`../src/dialogues/${file}`);
    return [dialogue.id, dialogue];
  }));
const memory = () => {
  const values = new Map();
  return { values, store: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
};

test('optional K7 conversations retain old transcripts, expire pending choices, and allow a later independent scene', () => {
  const { store } = memory();
  const progression = new Progression(story, store);
  const later = {
    ...structuredClone(definitions['k7-intro']),
    id: 'k7-act3-chat',
    start: 'later-opening',
    nodes: { 'later-opening': { messages: [{ speaker: 'contact', text: 'later scene', delayMs: 0, typingMs: 0 }], end: true } },
  };
  const catalog = { ...definitions, [later.id]: later };
  const optional = new OptionalConversations(progression, catalog, [
    { id: 'k7-intro', contactId: 'k7', optional: true, availableFrom: { flag: 'introAvailable' }, expiresAt: { sequence: 'act2-start' }, activityGraceMs: 30_000 },
    { id: later.id, contactId: 'k7', optional: true, availableFrom: { sequence: 'act3-start' }, expiresAt: { sequence: 'act4-start' } },
  ]);
  const thread = new ConversationThread('k7', progression, () => Object.values(catalog).filter((item) => item.contact?.id === 'k7'), (event) => optional.isAvailable(event.id));

  progression.data.flags.introAvailable = true;
  optional.sync(1_000);
  const intro = progression.data.dialogues['k7-intro'] = {
    revision: definitions['k7-intro'].revision ?? 1,
    node: 'first-contact', cursor: 5, finished: false,
    transcript: [{ speaker: 'contact', text: 'yoooooooo', receivedAt: 500 }],
  };
  optional.sync(1_100);
  thread.sync();
  assert.equal(optional.status('k7-intro'), 'started');
  assert.equal(thread.pendingResponses[0].choices.length, 3);
  progression.data.current = 'act2-start';
  optional.sync(2_000);
  assert.equal(optional.status('k7-intro'), 'expired');
  assert.equal(intro.expired, true);
  assert.equal(new DialogueSession(definitions['k7-intro'], progression).choices.length, 0);
  assert.equal(thread.pendingResponses.length, 0);
  assert.equal(thread.state.history.some((message) => message.text === 'yoooooooo'), true);

  progression.data.current = 'act3-start';
  optional.sync(3_000);
  assert.equal(optional.status(later.id), 'available');
  assert.equal(thread.activeDefinition.id, later.id);
  assert.equal(optional.isAvailable('k7-intro'), false, 'expired conversations do not reappear as catch-up dialogue');
  progression.save();
  const restored = new Progression(story, store);
  const restoredOptional = new OptionalConversations(restored, catalog, [
    { id: 'k7-intro', contactId: 'k7', optional: true, availableFrom: { flag: 'introAvailable' }, expiresAt: { sequence: 'act2-start' }, activityGraceMs: 30_000 },
    { id: later.id, contactId: 'k7', optional: true, availableFrom: { sequence: 'act3-start' }, expiresAt: { sequence: 'act4-start' } },
  ]);
  assert.equal(restoredOptional.status('k7-intro'), 'expired');
  assert.equal(restoredOptional.status(later.id), 'available');
  assert.equal(restored.data.dialogues['k7-intro'].transcript.length, 1);
});

test('started optional conversation gets a short activity grace, then expires without deleting its transcript', () => {
  const progression = new Progression(story, memory().store);
  const definition = definitions['k7-intro'];
  const optional = new OptionalConversations(progression, definitions, [
    { id: definition.id, contactId: 'k7', optional: true, availableFrom: { flag: 'introAvailable' }, expiresAt: { sequence: 'act2-start' }, activityGraceMs: 30_000 },
  ]);
  progression.data.flags.introAvailable = true;
  progression.data.dialogues[definition.id] = {
    revision: definition.revision ?? 1, node: 'first-contact', cursor: 5, finished: false,
    transcript: [
      { speaker: 'contact', text: 'yoooooooo', receivedAt: 1_000 },
      { speaker: 'player', text: 'quel son ?', receivedAt: 9_000 },
    ],
  };
  optional.sync(10_000);
  progression.data.completed.push('act2-start');
  optional.sync(12_000);
  assert.equal(optional.status(definition.id), 'started');
  optional.sync(38_999);
  assert.equal(optional.status(definition.id), 'started');
  optional.sync(39_000);
  assert.equal(optional.status(definition.id), 'expired');
  assert.equal(progression.data.dialogues[definition.id].transcript.length, 2);
});

test('optional relationship and choice data survive a save reload, including legacy saves without optional status', () => {
  const { values, store } = memory();
  const progression = new Progression(story, store);
  const definition = definitions['k7-intro'];
  progression.data.flags.k7IntroductionStarted = true;
  progression.data.choices.push({ key: 'k7-intro:first-contact', dialogue: 'k7-intro', node: 'first-contact', choice: 'ask-to-hear' });
  progression.data.dialogues['k7-intro'] = { node: 'hear-my-art', cursor: 1, finished: false, transcript: [{ speaker: 'player', text: 'ah ouais fais écouter', receivedAt: 1_000 }] };
  progression.save();
  const restored = new Progression(story, { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const optional = new OptionalConversations(restored, definitions);
  optional.sync(2_000);
  assert.deepEqual(optional.relationship('k7'), { hasReplied: true, hasSpoken: true, hasCompleted: false, hasMissed: false });
  assert.equal(restored.data.choices[0].choice, 'ask-to-hear');
  assert.equal(restored.data.dialogues['k7-intro'].transcript[0].text, 'ah ouais fais écouter');
});
