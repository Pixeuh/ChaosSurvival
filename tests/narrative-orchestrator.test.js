import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';
import { validateDialogue, DialogueSession } from '../src/story/dialogue.js';

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

function finishedDialogue(progression, id, nodeId, receivedAt = 50_000) {
  const node = definitions[id].nodes[nodeId];
  progression.data.dialogues[id] = {
    node: nodeId,
    cursor: node.messages.length,
    finished: true,
    revision: definitions[id].revision ?? 1,
    transcript: [{ speaker: 'contact', text: node.messages.at(-1).text, receivedAt }],
  };
}

function playDialogueToEnd(progression, id) {
  const session = new DialogueSession(definitions[id], progression);
  let steps = 0;
  while (!session.state.finished && steps++ < 300) {
    if (session.nextMessage()) {
      session.deliver(Date.now());
      continue;
    }
    if (session.node.transfer && session.activeTransfer?.status === 'pending') {
      progression.finishTransfer(session.activeTransfer.key);
      continue;
    }
    if (session.choices.length) {
      session.choose(session.choices[0].id);
      continue;
    }
    if (!session.advance()) break;
  }
  assert.equal(session.state.finished, true, `${id} can complete through its dialogue flow`);
  return session;
}

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
    k7: { id: 'k7', available: true, online: false },
  };
  const connectionNotifications = [];
  const turboMessages = [];
  const backgroundContacts = [];
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
  const k7Thread = new ConversationThread('k7', progression, () => [definitions['k7-intro']]);
  let orchestrator;
  const connectionMessages = new ConnectionMessages(
    progression,
    definitions,
    connectionMessageConfig,
    (id) => id === 'pixelgirl' ? pixelGirlThread : id === 'turbo' ? turboThread : id === 'k7' ? k7Thread : null,
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
    ensureBackground: (contact) => backgroundContacts.push(contact?.id),
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
    k7Thread,
    values,
    connectionNotifications,
    turboMessages,
    backgroundContacts,
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

test('K7 joins ten seconds after both private chats finish and the shared thread delivers messages progressively', () => {
  const context = fixture();
  const { progression, orchestrator } = context;
  progression.data.flags.superPlombierPostStarted = true;
  finishedDialogue(progression, 'turbo-super-plombier', 'last-goodbye');
  finishedDialogue(progression, 'pixelgirl-smiley-victory', 's8-common-1');
  finishedDialogue(progression, 'pixelgirl-super-plombier-wizz', 'ending');

  orchestrator.update(50_000);
  assert.equal(progression.data.flags.k7IntroductionStarted, true);
  assert.equal(orchestrator.isConversationUnlocked('k7-intro'), true);
  assert.equal(progression.data.flags.k7IntroductionStartedAt, 50_000);
  assert.deepEqual(progression.data.contactConnections.k7, { status: 'pending', dueAt: 60_000 });
  assert.equal(progression.data.flags.superPlombierGroupCreated, undefined);
  assert.equal(progression.data.flags.superPlombierPrivateChatsFinishedAt, 50_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 90_000);

  const resumed = fixture(context.values);
  resumed.orchestrator.update(59_999);
  assert.equal(resumed.progression.data.contactConnections.k7.status, 'pending');
  resumed.orchestrator.update(60_000);
  assert.equal(resumed.progression.data.contactConnections.k7.status, 'online');
  assert.equal(resumed.connectionNotifications.filter(({ id }) => id === 'k7').length, 1);
  assert.equal(resumed.backgroundContacts.includes('k7'), true, 'K7 uses the same background conversation path as other contacts');
  assert.equal(resumed.progression.data.dialogues['k7-intro'].receiveDueAt, 63_000);
  assert.equal(resumed.k7Thread.state.history.length, 0);
  resumed.orchestrator.onContactOpened({ id: 'k7' });
  assert.equal(resumed.progression.data.flags.k7FirstPlayerReplyAt, undefined);
  assert.equal(resumed.progression.data.flags.superPlombierGroupRestDueAt, 90_000);
  resumed.orchestrator.update(62_999);
  assert.deepEqual(resumed.k7Thread.receive(62_999), []);
  assert.equal(resumed.k7Thread.state.history.length, 0);
  resumed.orchestrator.update(63_000);
  assert.deepEqual(resumed.k7Thread.receive(63_000), [definitions['k7-intro']]);
  assert.equal(resumed.k7Thread.state.history.length, 1);
  assert.equal(resumed.k7Thread.state.history[0].text, definitions['k7-intro'].nodes['first-contact'].messages[0].text);
  const k7Messages = definitions['k7-intro'].nodes['first-contact'].messages;
  let nextDueAt = resumed.progression.data.dialogues['k7-intro'].receiveDueAt;
  for (let index = 1; index < k7Messages.length; index++) {
    assert.equal(resumed.k7Thread.typingContact(nextDueAt - k7Messages[index].typingMs)?.nickname, 'K7');
    resumed.orchestrator.update(nextDueAt);
    assert.deepEqual(resumed.k7Thread.receive(nextDueAt), [definitions['k7-intro']]);
    assert.equal(resumed.k7Thread.state.history.length, index + 1, 'the shared Messenger thread releases only one due message');
    assert.equal(resumed.k7Thread.state.history.at(-1).text, k7Messages[index].text);
    nextDueAt = resumed.progression.data.dialogues['k7-intro'].receiveDueAt;
  }
  const reopened = fixture(resumed.values);
  assert.equal(reopened.k7Thread.state.history.length, k7Messages.length);
  assert.equal(reopened.k7Thread.state.history.at(-1).text, k7Messages.at(-1).text);

  resumed.orchestrator.update(89_999);
  assert.equal(resumed.progression.data.flags.superPlombierGroupCreated, undefined);
  resumed.orchestrator.update(90_000);
  assert.equal(resumed.progression.data.flags.superPlombierGroupCreated, true, 'the group starts even if K7 is ignored');
  assert.equal(resumed.progression.data.dialogues['k7-intro'].finished, false);
  resumed.orchestrator.update(120_000);
  assert.equal(
    resumed.k7Thread.state.history.filter((message) => message.text === definitions['k7-intro'].nodes['first-contact'].messages[0].text).length,
    1,
    'the first spontaneous message is delivered only once',
  );
});

test('both completion orders start the K7 and group clocks only when the second private chat finishes', () => {
  for (const first of ['pixelgirl', 'turbo']) {
    const context = fixture();
    const { progression, orchestrator, k7Thread, connectionNotifications } = context;
    progression.data.flags.superPlombierPostStarted = true;
    progression.data.flags.superPlombierPixelCase = 'A';
    progression.data.flags.superPlombierWizzCount = 3;
    progression.data.flags.superPlombierHumorWizzesComplete = true;
    progression.data.contactConnections.k7 = { status: 'pending', dueAt: 99_000 };
    const pixelDone = first === 'pixelgirl';
    const turboDone = first === 'turbo';
    progression.data.dialogues['pixelgirl-smiley-victory'] = {
      node: 's8-common-1', cursor: 1, finished: pixelDone,
      transcript: [{ speaker: 'contact', text: pixelDone ? 'bon jreviens :3' : 'encore en cours', receivedAt: 8_000 }],
    };
    progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
      node: 'ending', cursor: 2, finished: pixelDone,
      transcript: [{ speaker: 'contact', text: pixelDone ? 'allez bisousss :3' : 'encore en cours', receivedAt: 9_000 }],
    };
    progression.data.dialogues['turbo-super-plombier'] = {
      node: 'last-goodbye', cursor: definitions['turbo-super-plombier'].nodes['last-goodbye'].messages.length,
      finished: turboDone,
      transcript: [{ speaker: 'contact', text: turboDone ? 'allez a+' : 'encore en cours', receivedAt: 10_000 }],
    };

    orchestrator.update(15_000);
    assert.equal(progression.data.flags.k7IntroductionStarted, undefined, `${first} finishing alone must not start K7`);
    assert.equal(progression.data.contactConnections.k7.dueAt, 99_000, 'an unrelated legacy pending connection is untouched');
    assert.equal(progression.data.flags.superPlombierGroupCreated, undefined);
    if (first === 'pixelgirl') {
      progression.data.dialogues['turbo-super-plombier'].finished = true;
      progression.data.dialogues['turbo-super-plombier'].transcript.at(-1).text = 'allez a+';
    } else {
      progression.data.dialogues['pixelgirl-smiley-victory'].finished = true;
      progression.data.dialogues['pixelgirl-smiley-victory'].transcript.at(-1).text = 'bon jreviens :3';
      progression.data.dialogues['pixelgirl-super-plombier-wizz'].finished = true;
      progression.data.dialogues['pixelgirl-super-plombier-wizz'].transcript.at(-1).text = 'allez bisousss :3';
    }
    const t0 = 15_000;
    orchestrator.update(t0);
    assert.equal(progression.data.flags.superPlombierPrivateChatsFinishedAt, t0);
    assert.equal(progression.data.contactConnections.k7.dueAt, t0 + 10_000);
    assert.equal(progression.data.flags.superPlombierGroupRestDueAt, t0 + 40_000);
    orchestrator.update(t0 + 10_000 - 1);
    assert.equal(progression.data.contactConnections.k7.status, 'pending');
    orchestrator.update(t0 + 10_000);
    assert.equal(progression.data.contactConnections.k7.status, 'online');
    assert.equal(connectionNotifications.filter(({ id }) => id === 'k7').length, 1);
    assert.equal(progression.data.dialogues['k7-intro'].receiveDueAt, t0 + 13_000);
    orchestrator.update(t0 + 13_000);
    assert.deepEqual(k7Thread.receive(t0 + 13_000), [definitions['k7-intro']]);
    assert.equal(
      k7Thread.state.history.filter((entry) => entry.text === definitions['k7-intro'].nodes['first-contact'].messages[0].text).length,
      1,
    );
    orchestrator.update(t0 + 40_000);
    assert.equal(progression.data.flags.superPlombierGroupCreated, true);
  }
});

test('real private dialogue completion order anchors K7 deadlines to the second completion', () => {
  const originalDateNow = Date.now;
  let clockNow = 100_000;
  Date.now = () => clockNow;
  try {
    for (const first of ['pixelgirl', 'turbo']) {
      const { progression, orchestrator, connectionNotifications, k7Thread } = fixture();
      progression.data.flags.superPlombierPostStarted = true;
      progression.data.flags.superPlombierPixelCase = 'A';
      progression.data.flags.superPlombierWizzCount = 3;
      progression.data.flags.superPlombierHumorWizzesComplete = true;
      const finishPixel = () => {
        playDialogueToEnd(progression, 'pixelgirl-smiley-victory');
        playDialogueToEnd(progression, 'pixelgirl-super-plombier-wizz');
      };
      const finishTurbo = () => playDialogueToEnd(progression, 'turbo-super-plombier');

      if (first === 'pixelgirl') finishPixel();
      else finishTurbo();
      orchestrator.update(clockNow);
      assert.equal(progression.data.flags.k7IntroductionStarted, undefined);
      const firstFinishAt = first === 'pixelgirl'
        ? progression.data.dialogues['pixelgirl-super-plombier-wizz'].transcript.at(-1).receivedAt
        : progression.data.dialogues['turbo-super-plombier'].transcript.at(-1).receivedAt;
      clockNow = firstFinishAt + 5_000;
      if (first === 'pixelgirl') finishTurbo();
      else finishPixel();
      orchestrator.update(clockNow);
      const connectionDueAt = clockNow + 10_000;
      assert.equal(progression.data.flags.k7IntroductionStarted, true);
      assert.equal(progression.data.contactConnections.k7.dueAt, connectionDueAt);
      assert.equal(progression.data.flags.superPlombierGroupRestDueAt, clockNow + 40_000);
      assert.equal(progression.data.flags.superPlombierGroupCreated, undefined);
      clockNow = connectionDueAt;
      orchestrator.update(clockNow);
      assert.equal(progression.data.contactConnections.k7.status, 'online');
      assert.equal(connectionNotifications.filter(({ id }) => id === 'k7').length, 1);
      assert.equal(progression.data.dialogues['k7-intro'].receiveDueAt, connectionDueAt + 3_000);
      clockNow = connectionDueAt + 3_000;
      orchestrator.update(clockNow);
      assert.deepEqual(k7Thread.receive(clockNow), [definitions['k7-intro']]);
      assert.equal(k7Thread.state.history[0].text, definitions['k7-intro'].nodes['first-contact'].messages[0].text);
    }
  } finally {
    Date.now = originalDateNow;
  }
});

test('K7 replies do not reset the persisted group deadline', () => {
  const context = fixture();
  const { progression, orchestrator, values } = context;
  progression.data.flags.superPlombierPostStarted = true;
  finishedDialogue(progression, 'pixelgirl-smiley-victory', 's8-common-1', 50_000);
  finishedDialogue(progression, 'pixelgirl-super-plombier-wizz', 'ending', 50_000);
  finishedDialogue(progression, 'turbo-super-plombier', 'last-goodbye', 50_000);
  orchestrator.update(10_000);
  orchestrator.update(10_000);
  orchestrator.update(20_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 50_000, 'the group deadline is 40 seconds after both private chats finish');

  const originalDateNow = Date.now;
  let clockNow = 69_000;
  Date.now = () => clockNow++;
  let dueAt;
  try {
    orchestrator.update(69_000);
    orchestrator.update(72_000);
    const session = new DialogueSession(definitions['k7-intro'], progression);
    let operations = 0;
    while (!session.state.finished && operations++ < 200) {
      if (session.nextMessage()) {
        session.deliver(clockNow++);
        continue;
      }
      if (session.node.transfer && session.activeTransfer?.status === 'pending') {
        progression.finishTransfer(session.activeTransfer.key);
        continue;
      }
      if (session.choices.length) {
        const nodeId = session.state.node;
        const choice = session.choices[0];
        context.now = clockNow;
        session.choose(choice.id);
        orchestrator.onChoiceValidated(definitions['k7-intro'], { nodeId, choice });
        if (!Number.isFinite(dueAt)) dueAt = progression.data.flags.superPlombierGroupRestDueAt;
        assert.equal(progression.data.flags.superPlombierGroupRestDueAt, dueAt);
        continue;
      }
      if (!session.advance()) break;
    }
    assert.equal(session.state.finished, true, `the complete K7 dialogue path remains playable: ${JSON.stringify(session.state)}`);
    orchestrator.update(clockNow++);
    assert.equal(dueAt, 50_000);
    assert.equal(progression.data.flags.superPlombierGroupRestDueAt, dueAt);
    assert.equal(progression.data.flags.superPlombierGroupCreated, true, 'K7 replies do not delay the group past T+40');
  } finally {
    Date.now = originalDateNow;
  }

  const resumed = fixture(values);
  assert.equal(resumed.progression.data.flags.superPlombierGroupCreated, true);
  resumed.orchestrator.update(dueAt - 1);
  assert.equal(resumed.progression.data.flags.superPlombierGroupCreated, true);
  resumed.orchestrator.update(dueAt);
  assert.equal(resumed.progression.data.flags.superPlombierGroupCreated, true);
});

test('K7 dialogue validates, stores its music choice and does not retrigger for saves past the group', () => {
  validateDialogue(definitions['k7-intro']);
  const context = fixture();
  const { progression, orchestrator, connectionNotifications } = context;
  assert.deepEqual(definitions['k7-intro'].nodes['first-contact'].choices.map(({ text }) => text), [
    'quel son ? xD', 'ah ouais fais écouter', 'on se connaît ? mdr',
  ]);
  assert.deepEqual(definitions['k7-intro'].nodes['player-activity'].choices.map(({ id }) => id), [
    'discovering', 'talking-to-people', 'nothing-special',
  ]);

  const musicSession = new DialogueSession(definitions['k7-intro'], progression);
  musicSession.state.node = 'music-question';
  musicSession.state.cursor = definitions['k7-intro'].nodes['music-question'].messages.length;
  musicSession.persist();
  musicSession.choose('music-electro');
  assert.equal(progression.data.flags.k7MusicPreference, 'electro');
  assert.ok(progression.data.choices.some((choice) => choice.dialogue === 'k7-intro' && choice.choice === 'music-electro'));
  assert.equal(musicSession.state.transcript.at(-1).text, "surtout de l'électro");
  const reloaded = fixture(context.values);
  assert.equal(reloaded.progression.data.flags.k7MusicPreference, 'electro');
  assert.equal(new DialogueSession(definitions['k7-intro'], reloaded.progression).state.transcript.at(-1).text, "surtout de l'électro");

  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierGroupCreated = true;
  finishedDialogue(progression, 'turbo-super-plombier', 'last-goodbye');
  finishedDialogue(progression, 'pixelgirl-smiley-victory', 's8-common-1');
  finishedDialogue(progression, 'pixelgirl-super-plombier-wizz', 'ending');
  orchestrator.update(90_000);
  assert.equal(progression.data.flags.k7IntroductionStarted, undefined);
  assert.equal(progression.data.contactConnections.k7, undefined);
  assert.equal(connectionNotifications.some(({ id }) => id === 'k7'), false);
});

test('an in-progress K7 save without the introduction flag is unlocked in place without replaying messages', () => {
  const context = fixture();
  const { progression, orchestrator, connectionNotifications } = context;
  progression.data.flags.superPlombierPostStarted = true;
  finishedDialogue(progression, 'turbo-super-plombier', 'last-goodbye');
  finishedDialogue(progression, 'pixelgirl-smiley-victory', 's8-common-1');
  finishedDialogue(progression, 'pixelgirl-super-plombier-wizz', 'ending');
  progression.data.dialogues['k7-intro'] = {
    node: 'people-reply',
    cursor: 1,
    finished: false,
    revision: 1,
    transcript: [
      { speaker: 'contact', text: 'et sinon tu fais quoi toi ?', receivedAt: 40_000 },
      { speaker: 'player', text: 'je parle avec des gens', receivedAt: 40_500 },
    ],
  };
  progression.data.contactConnections.k7 = { status: 'online', connectedAt: 37_000 };
  progression.save();

  assert.equal(orchestrator.isConversationUnlocked('k7-intro'), false);
  orchestrator.update(50_000);
  assert.equal(progression.data.flags.k7IntroductionStarted, true);
  assert.equal(progression.data.flags.k7IntroductionStartedAt, 40_000);
  assert.equal(orchestrator.isConversationUnlocked('k7-intro'), true);
  assert.equal(progression.data.dialogues['k7-intro'].transcript.length, 2);
  assert.equal(progression.data.dialogues['k7-intro'].node, 'people-reply');
  assert.equal(connectionNotifications.some(({ id }) => id === 'k7'), false);
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
