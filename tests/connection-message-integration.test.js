import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { NarrativeOrchestrator, DEFERRED_CONNECTION_DIALOGUES } from '../src/story/narrative-orchestrator.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';
import { ReplayReactions } from '../src/story/replays.js';
import { Messenger } from '../src/ui/messenger.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const replayConfig = read('../src/config/replay-reactions.json');
const connectionConfig = read('../src/config/connection-messages.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const definition = read(`../src/dialogues/${file}`);
      return [definition.id, definition];
    }),
);

function createHarness() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  let now = 10_000;
  const originalNow = Date.now;
  Date.now = () => now;
  const replayReactions = new ReplayReactions(progression, definitions, replayConfig);
  let narrativeOrchestrator;
  const turboThread = new ConversationThread('turbo', progression, () => [
    definitions['turbo-smiley-catcher'],
    ...(narrativeOrchestrator?.isEventAvailable(definitions['turbo-flashzone-invitation'])
      ? [definitions['turbo-flashzone-invitation']]
      : []),
    ...(narrativeOrchestrator?.isEventAvailable(definitions['turbo-super-plombier'])
      ? [definitions['turbo-super-plombier']]
      : []),
  ]);
  const primaryView = {
    thread: replayReactions.thread,
    dialogue: definitions['pixelgirl-intro'],
    offlineContact: null,
    element: { isConnected: false, hidden: true, style: { zIndex: '1' } },
    refresh() {},
    openMinimized() {
      this.element.isConnected = true;
      this.element.hidden = true;
    },
  };
  const turboView = {
    thread: turboThread,
    dialogue: definitions['turbo-smiley-catcher'],
    offlineContact: null,
    element: { isConnected: true, hidden: true, style: { zIndex: '1' } },
    refresh() {},
  };
  const messenger = new Messenger({
    manager: { windows: new Map() },
    progression,
    primary: () => primaryView,
    definitions: () => definitions,
    createConversation: (contact) => contact.id === 'turbo' ? turboView : {
      thread: new ConversationThread(contact.id, progression, () => []),
      dialogue: definitions[contact.dialogue],
      offlineContact: null,
      element: { isConnected: false, hidden: true, style: { zIndex: '1' } },
      refresh() {},
    },
    sounds: { unlock: () => Promise.resolve(), play() {} },
    onMessage: (contact, incoming, messages, view, state) => {
      narrativeOrchestrator?.onMessage(contact, incoming);
      received.push({ at: now, contactId: contact.id, incoming, messages, active: state.active });
    },
    onContactOpened() {},
  });
  const connectionNotifications = [];
  const received = [];
  const connectionMessages = new ConnectionMessages(
    progression,
    definitions,
    connectionConfig,
    (id) => id === 'pixelgirl' ? replayReactions.thread : id === 'turbo' ? turboThread : null,
  );
  const dialogueEvents = new DialogueEvents(
    progression,
    definitions,
    (id, connectedAt) => narrativeOrchestrator.onContactConnected(id, connectedAt),
    { deferredConnectionDialogues: DEFERRED_CONNECTION_DIALOGUES },
  );
  narrativeOrchestrator = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents,
    getContact: (id) => messenger.contacts().find((contact) => contact.id === id),
    prepareContact: (contact) => messenger.prepareContact(contact),
    getTurboThread: () => turboThread,
    connectionMessages,
    showConnectionNotification: (id) => connectionNotifications.push({ id, at: now }),
    onTurboMessage: (contact, incoming, messages) =>
      messenger.receiveIncoming(contact, incoming, messages, turboView),
    now: () => now,
  });

  return {
    progression,
    replayReactions,
    turboThread,
    primaryView,
    turboView,
    messenger,
    connectionMessages,
    dialogueEvents,
    narrativeOrchestrator,
    connectionNotifications,
    received,
    set now(value) { now = value; },
    get now() { return now; },
    close() { Date.now = originalNow; },
  };
}

function mainUpdateCycle(game, { receivePixelGirl = true } = {}) {
  const incoming = game.replayReactions.flush(game.now, { canReceive: receivePixelGirl });
  game.narrativeOrchestrator.update(game.now, true);
  game.messenger.update();
  if (incoming.length) {
    const contact = game.messenger.contacts().find((entry) => entry.id === 'pixelgirl');
    game.messenger.receiveIncoming(
      contact,
      incoming,
      game.replayReactions.thread.lastIncomingMessages ?? [],
      game.primaryView,
    );
  }
}

test('real Turb0 connection update cycle cannot deliver early through Messenger.update', () => {
  const game = createHarness();
  try {
    const arrival = definitions['pixelgirl-smiley-victory'];
    game.narrativeOrchestrator.onChoiceValidated(arrival, { nodeId: arrival.start });
    mainUpdateCycle(game);
    assert.equal(game.progression.data.contactConnections.turbo.status, 'pending');

    game.now = 11_999;
    mainUpdateCycle(game);
    assert.equal(game.progression.data.dialogues['turbo-smiley-catcher']?.transcript.length ?? 0, 0);

    game.now = 12_000;
    mainUpdateCycle(game);
    assert.equal(game.progression.data.contactConnections.turbo.status, 'online');
    assert.equal(game.progression.data.contactConnections.turbo.connectedAt, 12_000);
    assert.deepEqual(game.connectionNotifications, [{ id: 'turbo', at: 12_000 }]);
    assert.equal(game.progression.data.pendingConnectionMessages['turbo-first-connection'].dueAt, 15_000);

    game.now = 14_999;
    mainUpdateCycle(game);
    assert.equal(game.progression.data.dialogues['turbo-smiley-catcher'].transcript.length, 0);
    assert.equal(game.received.length, 0);

    game.now = 15_000;
    mainUpdateCycle(game);
    assert.equal(game.progression.data.dialogues['turbo-smiley-catcher'].transcript[0].text, 'mdrrrr noob');
    assert.equal(game.received.length, 1);
    assert.equal(game.received[0].at, 15_000);
    assert.equal(game.received[0].active, false);
    assert.equal(game.received[0].messages.length, 1);
    assert.equal(game.received[0].messages[0].text, 'mdrrrr noob');
    mainUpdateCycle(game);
    assert.equal(game.received.length, 1);
  } finally {
    game.close();
  }
});

test('PixelGirl first message follows her connection event with or without an open conversation', () => {
  for (const openDuringWait of [false, true]) {
    const game = createHarness();
    try {
      game.progression.complete('arcade-1', { score: 100, closed: 4 }, game.now);
      game.narrativeOrchestrator.onContactConnected('pixelgirl', game.now);
      mainUpdateCycle(game);
      assert.equal(game.progression.data.dialogues['pixelgirl-intro'].transcript.length, 0);

      if (openDuringWait) {
        game.primaryView.element.isConnected = true;
        game.primaryView.element.hidden = false;
      }
      game.now += 2999;
      mainUpdateCycle(game);
      assert.equal(game.progression.data.dialogues['pixelgirl-intro'].transcript.length, 0);

      game.now += 1;
      mainUpdateCycle(game);
      assert.equal(game.progression.data.dialogues['pixelgirl-intro'].transcript[0].text, 'heyyyy :DDD');
      assert.equal(game.received.length, 1);
      assert.equal(game.received[0].at, 13_000);
      assert.equal(game.received[0].active, openDuringWait);
      assert.equal(game.progression.data.pendingConnectionMessages['pixelgirl-first-desktop'], undefined);
    } finally {
      game.close();
    }
  }
});
