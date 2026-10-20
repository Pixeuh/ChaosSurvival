import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { DialogueSession } from '../src/story/dialogue.js';

const k7 = {
  ...JSON.parse(readFileSync(new URL('../src/dialogues/k7-intro.json', import.meta.url), 'utf8')),
};
const story = {
  version: 1,
  start: 'chat',
  sequences: [{ id: 'chat', type: 'conversation', dialogue: k7.id, next: null }],
};

function setup(definition = k7, values = new Map(), contactId = 'k7') {
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const thread = new ConversationThread(contactId, progression, () => [definition]);
  return { progression, thread, values };
}

function texts(thread) {
  return thread.state.history.map((entry) => entry.text);
}

test('K7 intro messages arrive individually and reveal choices only after the final message', () => {
  const { progression, thread } = setup();
  const definition = k7;
  let now = 10_000;
  thread.schedule(definition, now);
  const firstDueAt = progression.data.dialogues[k7.id].receiveDueAt;
  progression.data.pendingConnectionMessages['k7-first-message'] = {
    runId: progression.data.runId,
    dialogueId: k7.id,
    connectedAt: firstDueAt - 3_000,
    dueAt: firstDueAt,
  };

  for (let index = 0; index < 5; index++) {
    const message = definition.nodes['first-contact'].messages[index];
    const dueAt = progression.data.dialogues[k7.id].receiveDueAt;
    const typingMs = message.typingMs || Math.max(180, Math.min(900, (message.text?.length ?? 20) * 18));
    assert.equal(thread.typingContact(dueAt - typingMs)?.nickname, 'K7');
    assert.deepEqual(thread.receive(dueAt), [definition]);
    assert.equal(texts(thread).length, index + 1);
    assert.equal(thread.typingContact(dueAt), null, 'typing ends as the scheduled message is received');
    if (index < 4) {
      const next = definition.nodes['first-contact'].messages[index + 1];
      now = dueAt;
      assert.equal(progression.data.dialogues[k7.id].receiveDueAt,
        now + next.delayMs + next.typingMs + (next.typingPauseMs ?? 0));
      assert.equal(thread.availableResponses.length, 0);
    }
  }
  assert.equal(firstDueAt, 10_000);
  assert.equal(thread.availableResponses[0].choices.length, 3);
});

test('a long update delay releases one K7 message and schedules the next from actual receipt time', () => {
  const { progression, thread } = setup();
  thread.schedule(k7, 0);

  assert.deepEqual(thread.receiveScheduled(k7, 10_000), true);
  thread.sync();
  assert.equal(texts(thread).length, 1);
  assert.equal(progression.data.dialogues[k7.id].receiveDueAt, 10_000 + 350 + 280);
  assert.ok(progression.data.dialogues[k7.id].receiveDueAt > 10_000);
  assert.equal(thread.receiveScheduled(k7, 10_000), false, 'repeated updates at one instant cannot drain the queue');
  assert.equal(thread.receiveScheduled(k7, 10_630), true);
  thread.sync();
  assert.equal(texts(thread).length, 2);
  assert.equal(progression.data.dialogues[k7.id].receiveDueAt, 10_630 + 650 + 520);
  assert.equal(thread.receiveScheduled(k7, 10_630), false);
});

test('legacy receive path also catches up at most one message per update', () => {
  const definition = { ...k7, incomingAt: 0 };
  const { progression, thread } = setup(definition);
  assert.deepEqual(thread.receive(20_000), [definition]);
  assert.equal(texts(thread).length, 1);
  assert.equal(progression.data.dialogues[k7.id].receiveDueAt, 20_000 + 350 + 280);
  assert.deepEqual(thread.receive(20_000), []);
  assert.equal(texts(thread).length, 1);
});

test('every contact thread releases only one overdue message and anchors the next deadline to receipt time', () => {
  const definition = {
    id: 'ordinary-contact',
    version: 1,
    contact: { id: 'friend', name: 'Friend', nickname: 'Friend', status: 'En ligne' },
    player: { nickname: 'JustMe' },
    start: 'burst',
    incomingAt: 0,
    nodes: {
      burst: {
        messages: [
          { speaker: 'contact', text: 'one', delayMs: 0, typingMs: 0 },
          { speaker: 'contact', text: 'two', delayMs: 300, typingMs: 200, typingPauseMs: 100 },
          { speaker: 'contact', text: 'three', delayMs: 400, typingMs: 250 },
        ],
        choices: [{ id: 'reply', text: 'reply', next: 'end' }],
      },
      end: { messages: [], end: true },
    },
  };
  const { progression, thread } = setup(definition);

  assert.deepEqual(thread.receive(10_000), [definition]);
  assert.deepEqual(texts(thread), ['one']);
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, 10_600);
  assert.deepEqual(thread.receive(10_000), []);
  assert.deepEqual(thread.receive(10_599), []);

  assert.deepEqual(thread.receive(12_000), [definition]);
  assert.deepEqual(texts(thread), ['one', 'two']);
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, 12_650);
  assert.deepEqual(thread.receive(12_000), []);
  assert.equal(thread.availableResponses.length, 0);

  assert.deepEqual(thread.receive(20_000), [definition]);
  assert.deepEqual(texts(thread), ['one', 'two', 'three']);
  assert.equal(thread.availableResponses[0].choices[0].id, 'reply');
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, undefined);
});

test('independent due events on one contact retain their own deadlines and histories', () => {
  const first = {
    id: 'first-event', version: 1, contact: k7.contact, player: k7.player, start: 'start', incomingAt: 0,
    nodes: { start: { messages: [{ speaker: 'contact', text: 'first', delayMs: 0, typingMs: 0 }], end: true } },
  };
  const second = {
    ...first,
    id: 'second-event',
    nodes: { start: { messages: [{ speaker: 'contact', text: 'second', delayMs: 0, typingMs: 0 }], end: true } },
  };
  const { thread } = setup(first);
  thread.getEvents = () => [first, second];

  assert.deepEqual(thread.receive(10_000), [first, second]);
  assert.deepEqual(thread.lastIncomingMessages.map(({ text }) => text), ['first', 'second']);
  assert.deepEqual(thread.receive(10_000), []);
});

test('generic group and choice branches keep their deadlines progressive across reload', () => {
  const definition = {
    id: 'generic-branch', version: 1,
    contact: { id: 'group', name: 'Group', nickname: 'Friends', status: 'En ligne' },
    player: { nickname: 'JustMe' }, start: 'opening',
    nodes: {
      opening: {
        messages: [{ speaker: 'contact', author: 'Friend A', text: 'question', delayMs: 0, typingMs: 0 }],
        choices: [{ id: 'answer', text: 'answer', next: 'reply' }],
      },
      reply: {
        messages: [
          { speaker: 'contact', author: 'Friend B', text: 'reply one', delayMs: 200, typingMs: 100 },
          { speaker: 'contact', author: 'Friend A', text: 'reply two', delayMs: 300, typingMs: 200, typingPauseMs: 100 },
        ],
        end: true,
      },
    },
  };
  const { progression, thread, values } = setup(definition, new Map(), 'group');
  thread.schedule(definition, 1_000);
  assert.deepEqual(thread.receive(10_000), [definition]);
  const session = new DialogueSession(definition, progression);
  session.choose('answer');
  thread.schedule(definition, 10_000);
  assert.deepEqual(thread.receiveScheduled(definition, 20_000), true);
  thread.sync();
  assert.deepEqual(
    progression.data.dialogues[definition.id].transcript.filter(({ speaker }) => speaker === 'contact').map(({ text }) => text),
    ['question', 'reply one'],
  );
  assert.equal(progression.data.dialogues[definition.id].receiveDueAt, 20_600);
  assert.deepEqual(thread.receive(20_000), []);

  const restoredProgression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  const restored = new ConversationThread('group', restoredProgression, () => [definition]);
  assert.deepEqual(restored.receive(20_599), []);
  assert.deepEqual(restored.receive(20_600), [definition]);
  assert.deepEqual(
    restoredProgression.data.dialogues[definition.id].transcript.filter(({ speaker }) => speaker === 'contact').map(({ text }) => text),
    ['question', 'reply one', 'reply two'],
  );
  assert.deepEqual(restored.availableResponses, []);
});

test('the next K7 deadline and received history survive reload without duplicate delivery', () => {
  const { progression, thread, values } = setup();
  thread.schedule(k7, 1_000);
  thread.receive(progression.data.dialogues[k7.id].receiveDueAt);
  let dueAt = progression.data.dialogues[k7.id].receiveDueAt;
  thread.receive(dueAt);
  assert.equal(texts(thread).length, 2);
  dueAt = progression.data.dialogues[k7.id].receiveDueAt;

  const restoredProgression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  const restored = new ConversationThread('k7', restoredProgression, () => [k7]);
  assert.equal(texts(restored).length, 2);
  assert.deepEqual(restored.receive(dueAt - 1), []);
  assert.deepEqual(restored.receive(dueAt), [k7]);
  assert.equal(texts(restored).length, 3);
  assert.equal(restored.state.history[2].text, k7.nodes['first-contact'].messages[2].text);
  const fourth = k7.nodes['first-contact'].messages[3];
  assert.equal(restoredProgression.data.dialogues[k7.id].receiveDueAt,
    dueAt + fourth.delayMs + fourth.typingMs + (fourth.typingPauseMs ?? 0));
});

test('each opening K7 answer starts its branch progressively', () => {
  for (const choice of k7.nodes['first-contact'].choices) {
    const { progression, thread } = setup();
    thread.schedule(k7, 0);
    for (let index = 0; index < 5; index++) {
      const dueAt = progression.data.dialogues[k7.id].receiveDueAt;
      assert.deepEqual(thread.receive(dueAt), [k7]);
    }
    assert.equal(thread.availableResponses[0].choices.some(({ id }) => id === choice.id), true);
    new DialogueSession(k7, progression).choose(choice.id);

    const now = Date.now();
    thread.schedule(k7, now);
    const dueAt = progression.data.dialogues[k7.id].receiveDueAt;
    assert.deepEqual(thread.receiveScheduled(k7, dueAt), true);
    thread.sync();
    assert.equal(texts(thread).length, 7, 'only the first branch response is delivered');
    assert.equal(texts(thread).at(-1), k7.nodes[choice.next].messages[0].text);
    const next = k7.nodes[choice.next].messages[1];
    const nextDueAt = progression.data.dialogues[k7.id].receiveDueAt;
    assert.equal(nextDueAt, dueAt + next.delayMs + next.typingMs + (next.typingPauseMs ?? 0));
    assert.ok(nextDueAt > dueAt);
    assert.equal(thread.receiveScheduled(k7, dueAt), false,
      'repeated updates cannot duplicate branch messages');
  }
});
