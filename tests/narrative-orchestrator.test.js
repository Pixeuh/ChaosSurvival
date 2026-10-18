import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const connectionMessageConfig = read('../src/config/connection-messages.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const definition = read(`../src/dialogues/${file}`);
      return [definition.id, definition];
    }),
);

function fixture(values = new Map()) {
  const progression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  let now = 10_000;
  const contacts = {
    pixelgirl: { id: 'pixelgirl', available: true, online: true },
    turbo: { id: 'turbo', available: true, online: true },
    luna: { id: 'luna', available: true, online: true },
  };
  const connectionNotifications = [];
  const turboMessages = [];
  const preparedContacts = [];
  const turboThread = new ConversationThread('turbo', progression, () => [
    definitions['turbo-smiley-catcher'],
    definitions['turbo-flashzone-invitation'],
  ]);
  const pixelGirlThread = new ConversationThread('pixelgirl', progression, () =>
    progression.data.unlockedConversations.includes('pixelgirl-intro')
      ? [definitions['pixelgirl-intro']]
      : [],
  );
  let orchestrator;
  const connectionMessages = new ConnectionMessages(
    progression,
    definitions,
    connectionMessageConfig,
    (id) => id === 'pixelgirl' ? pixelGirlThread : id === 'turbo' ? turboThread : null,
  );
  const events = new DialogueEvents(
    progression,
    definitions,
    (id, connectedAt) => orchestrator.onContactConnected(id, connectedAt),
    { deferredConnectionDialogues: ['pixelgirl-smiley-victory'] },
  );
  orchestrator = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: events,
    getContact: (id) => contacts[id],
    prepareContact: (contact) => {
      preparedContacts.push(contact?.id);
      return { thread: turboThread };
    },
    getTurboThread: () => turboThread,
    connectionMessages,
    onTurboMessage: (contact, incoming, messages) => turboMessages.push({ contact, incoming, messages }),
    showConnectionNotification: (id, options) => connectionNotifications.push({ id, options }),
    now: () => now,
  });
  return {
    progression,
    orchestrator,
    turboThread,
    pixelGirlThread,
    values,
    connectionNotifications,
    turboMessages,
    preparedContacts,
    get now() {
      return now;
    },
    set now(value) {
      now = value;
    },
  };
}

test('validating PixelGirl first reply saves Turb0 connection for exactly two seconds later', () => {
  const context = fixture();
  const { progression, orchestrator, connectionNotifications } = context;
  const definition = definitions['pixelgirl-smiley-victory'];
  orchestrator.onChoiceValidated(definition, { nodeId: definition.start });
  orchestrator.onChoiceValidated(definition, { nodeId: definition.start });

  assert.equal(progression.data.flags.turboSmileyScene3ArrivalTriggered, true);
  assert.deepEqual(progression.data.contactConnections.turbo, { status: 'pending', dueAt: 12_000 });
  assert.equal(connectionNotifications.length, 0);
  const restored = fixture(context.values);
  restored.now = 11_999;
  restored.orchestrator.update(restored.now);
  assert.equal(restored.progression.data.contactConnections.turbo.status, 'pending');
  assert.equal(restored.connectionNotifications.length, 0);
  restored.now = 12_000;
  restored.orchestrator.update(restored.now);
  assert.equal(restored.progression.data.contactConnections.turbo.status, 'online');
  assert.equal(restored.connectionNotifications.length, 1);
  assert.equal(restored.progression.data.dialogues['turbo-smiley-catcher'].receiveDueAt, 15_000);
  assert.deepEqual(restored.preparedContacts, [], 'connection alone does not create a conversation window');
  assert.equal(restored.turboThread.state.history.length, 0);
  restored.now = 14_999;
  restored.orchestrator.update(restored.now);
  assert.equal(restored.turboThread.state.history.length, 0);
  assert.equal(restored.turboMessages.length, 0);
  restored.now = 15_000;
  restored.orchestrator.update(restored.now);
  assert.equal(restored.turboThread.state.history.at(-1).text, 'mdrrrr noob');
  assert.equal(restored.turboMessages.length, 1);
  assert.equal(restored.turboMessages[0].messages.length, 1);
  assert.equal(restored.turboMessages[0].messages[0].text, 'mdrrrr noob');
  restored.orchestrator.update(20_000);
  assert.equal(restored.turboMessages.length, 1);
  assert.equal(restored.connectionNotifications.length, 1);
});

test('PixelGirl connection notification and first intro message use one three-second connection deadline', () => {
  const { progression, orchestrator, pixelGirlThread, connectionNotifications, preparedContacts } = fixture();
  progression.complete('arcade-1', { score: 100, closed: 4 }, 2000);

  orchestrator.onContactConnected('pixelgirl', 5000, { notify: true });
  assert.deepEqual(connectionNotifications, [{ id: 'pixelgirl', options: undefined }]);
  assert.equal(progression.data.dialogues['pixelgirl-intro'].receiveDueAt, 8000);
  assert.deepEqual(pixelGirlThread.receive(7999), []);
  assert.deepEqual(pixelGirlThread.receive(8000), [definitions['pixelgirl-intro']]);
  assert.equal(pixelGirlThread.state.history.at(-1).text, 'heyyyy :DDD');
  assert.deepEqual(preparedContacts, [], 'scheduling the message does not create a conversation window');
  assert.deepEqual(pixelGirlThread.receive(8000), []);
});

test('a validated mini-game result delays only its next narrative reaction and survives reload', () => {
  const originalNow = Date.now;
  Date.now = () => 10_000;
  try {
    const values = new Map();
    const progression = new Progression(story, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    progression.data.current = 'super-mega-game';
    assert.equal(progression.complete('super-mega-game', { won: true }), true);
    assert.deepEqual(progression.data.pendingMiniGameReaction, {
      runId: progression.data.runId,
      sequenceId: 'super-mega-game',
      storySequenceId: 'pixelgirl-smiley-win',
      dialogueId: 'pixelgirl-smiley-victory',
      dueAt: 12_000,
    });

    const reaction = definitions['pixelgirl-smiley-victory'];
    const unrelated = structuredClone(reaction);
    unrelated.id = 'unrelated-message';
    unrelated.start = 'start';
    unrelated.nodes = {
      start: { messages: [{ speaker: 'contact', text: 'independent', delayMs: 0, typingMs: 0 }], end: true },
    };
    const thread = new ConversationThread('pixelgirl', progression, () => [reaction, unrelated]);
    thread.schedule(reaction, 10_000);
    thread.schedule(unrelated, 10_000);
    assert.deepEqual(thread.receive(10_000), [unrelated], 'unrelated MSN events remain immediate');
    assert.deepEqual(thread.receive(11_999), []);

    const restored = new Progression(story, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const restoredThread = new ConversationThread('pixelgirl', restored, () => [reaction]);
    assert.deepEqual(restoredThread.receive(11_999), []);
    assert.deepEqual(restoredThread.receive(12_000), [reaction]);
    assert.equal(restoredThread.state.history.at(-1).text, reaction.nodes.s1.messages[0].text);
    assert.equal(restored.data.pendingMiniGameReaction, null);
    assert.deepEqual(restoredThread.receive(12_000), [], 'the first reaction is delivered only once');
    assert.deepEqual(restoredThread.receive(12_499), []);
    assert.deepEqual(restoredThread.receive(12_500), [reaction], 'dialogue message timing continues normally');

    const resetValues = new Map();
    const pendingGame = new Progression(story, {
      getItem: (key) => resetValues.get(key) ?? null,
      setItem: (key, value) => resetValues.set(key, value),
    });
    pendingGame.data.current = 'super-mega-game';
    pendingGame.complete('super-mega-game', { won: true });
    const pendingThread = new ConversationThread('pixelgirl', pendingGame, () => [reaction]);
    pendingThread.schedule(reaction, 10_000);
    pendingGame.newGame();
    assert.equal(pendingGame.data.pendingMiniGameReaction, null);
    const cleanThread = new ConversationThread('pixelgirl', pendingGame, () =>
      pendingGame.data.unlockedConversations.includes(reaction.id) ? [reaction] : [],
    );
    assert.deepEqual(cleanThread.receive(30_000), [], 'New Game invalidates the old reaction deadline');

    const invalidated = new Progression(story, { getItem: () => null, setItem() {} });
    invalidated.data.current = 'super-mega-game';
    invalidated.complete('super-mega-game', { won: true });
    const invalidatedThread = new ConversationThread('pixelgirl', invalidated, () => [reaction]);
    invalidated.data.current = 'arcade-1';
    assert.equal(invalidatedThread.miniGameReactionDueAt(reaction), null);
    assert.equal(invalidated.data.pendingMiniGameReaction, null, 'an invalidated story event retires its deadline');
  } finally {
    Date.now = originalNow;
  }
});

test('the existing three-second first-connection delay remains longer than the mini-game minimum', () => {
  const originalNow = Date.now;
  Date.now = () => 10_000;
  try {
    const progression = new Progression(story, { getItem: () => null, setItem() {} });
    progression.data.current = 'arcade-1';
    progression.complete('arcade-1', { score: 100, closed: 4, newRecord: false });
    const intro = definitions['pixelgirl-intro'];
    const first = intro.nodes[intro.start].messages[0];
    const firstDuration = first.delayMs + first.typingMs + (first.typingPauseMs ?? 0);
    const thread = new ConversationThread('pixelgirl', progression, () => [intro]);
    thread.schedule(intro, 10_000 + 3000 - firstDuration);
    assert.equal(progression.data.dialogues[intro.id].receiveDueAt, 13_000);
    assert.deepEqual(thread.receive(12_999), []);
    assert.deepEqual(thread.receive(13_000), [intro]);
  } finally {
    Date.now = originalNow;
  }
});

test('Turb0 message notification is tied to receiving a new message, not a saved timer', () => {
  const context = fixture();
  const { progression, orchestrator } = context;
  progression.data.flags.turboSmileyScene3ArrivalTriggered = true;
  progression.data.contactConnections = { turbo: { status: 'online' } };
  orchestrator.onContactConnected('turbo');
  const received = definitions['turbo-smiley-catcher'];
  assert.equal(orchestrator.onMessage({ id: 'turbo' }), 'handled');
  assert.equal(orchestrator.onMessage({ id: 'turbo' }, [received]), 'turbo-smiley-scene3');
  assert.equal(progression.data.flags.turboSmileyScene3Notified, true);
  assert.equal(orchestrator.onMessage({ id: 'turbo' }, [received]), 'handled');

  progression.data.flags.turboSmileyScene3Notified = false;
  progression.data.flags.turboSmileyScene3MessageNotificationDueAt = 20_000;
  progression.data.dialogues['turbo-smiley-catcher'] = {
    node: 'opening',
    cursor: 1,
    finished: false,
    transcript: [{ speaker: 'contact', text: 'mdrrrr noob' }],
  };
  progression.save();
  const restored = fixture(context.values);
  assert.equal(restored.progression.data.flags.turboSmileyScene3MessageNotificationDueAt, undefined);
  restored.orchestrator.update(30_000);
});

test('invitation message uses the shared three-second post-connection schedule and only once', () => {
  const context = fixture();
  const { progression, orchestrator, now } = context;
  progression.data.contactConnections = { luna: { status: 'online' } };
  progression.data.dialogues['turbo-smiley-catcher'] = {
    node: 'noob-reply',
    cursor: 1,
    finished: true,
    transcript: [{ speaker: 'contact', text: 'MDRRR' }],
  };
  orchestrator.onContactConnected('luna', now);
  assert.deepEqual(progression.data.pendingConnectionMessages['luna-invitation-after-connection'], {
    runId: progression.data.runId,
    contactId: 'luna',
    dialogueId: 'turbo-flashzone-invitation',
    dueAt: now + 3000,
    connectedAt: now,
  });
  const definition = definitions['turbo-flashzone-invitation'];
  assert.equal(orchestrator.isEventAvailable(definition), true);

  const restored = fixture(context.values);
  restored.now = now + 2999;
  restored.orchestrator.update(restored.now);
  assert.equal(
    restored.progression.data.dialogues['turbo-flashzone-invitation']?.receiveDueAt,
    now + 3000,
  );
  assert.equal(
    restored.progression.data.dialogues['turbo-flashzone-invitation']?.transcript.length,
    0,
  );
  assert.equal(restored.orchestrator.isEventAvailable(definition), true);
  restored.now = now + 3000;
  restored.orchestrator.update(restored.now);
  assert.equal(
    restored.progression.data.dialogues['turbo-flashzone-invitation']?.receiveDueAt,
    now + 3000,
  );
  assert.equal(restored.orchestrator.isEventAvailable(definition), true);
  assert.deepEqual(restored.turboThread.receive(now + 2999), []);
  assert.deepEqual(restored.turboThread.receive(now + 3000), [definition]);
  assert.equal(restored.turboThread.state.history.at(-1).text, definition.nodes.invitation.messages[0].text);
  assert.deepEqual(restored.turboThread.receive(now + 3000), []);
  assert.equal(
    restored.turboThread.state.history.filter(
      (entry) => entry.eventId === definition.id && entry.text === definition.nodes.invitation.messages[0].text,
    ).length,
    1,
  );
  restored.now = now + 4000;
  restored.orchestrator.update(restored.now);
});

test('FlashZone unlocks when the invitation link is delivered and restores compatible saves', () => {
  const context = fixture();
  const { progression, orchestrator, values } = context;
  assert.equal(progression.data.flags.superPlombierFlashUnlocked, undefined);
  orchestrator.onLink('http://www.flashzone.fr/jeux/super-plombier-flash');
  assert.equal(progression.data.flags.superPlombierFlashUnlocked, undefined);

  progression.data.dialogues['turbo-flashzone-invitation'] = {
    transcript: [
      {
        speaker: 'contact',
        type: 'link',
        url: 'http://www.flashzone.fr/jeux/super-plombier-flash',
      },
    ],
    finished: true,
  };
  orchestrator.afterMessengerUpdate();
  assert.equal(progression.data.flags.superPlombierFlashUnlocked, true);
  assert.equal(fixture(values).progression.data.flags.superPlombierFlashUnlocked, true);

  const oldWonSave = fixture();
  oldWonSave.progression.data.flags.superPlombierFirstCompletion = true;
  oldWonSave.progression.save();
  assert.equal(fixture(oldWonSave.values).progression.data.flags.superPlombierFlashUnlocked, true);
});
