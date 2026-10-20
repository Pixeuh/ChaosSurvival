import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueSession, validateDialogue } from '../src/story/dialogue.js';
import { ReplayReactions } from '../src/story/replays.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { ConversationWindow } from '../src/ui/conversation.js';
import { visibleContacts } from '../src/ui/contacts.js';
import { MiniGameLauncher } from '../src/ui/minigame-launcher.js';
import { registerMiniGame } from '../src/ui/minigame-registry.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const config = read('../src/config/replay-reactions.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const d = read(`../src/dialogues/${file}`);
      return [d.id, d];
    }),
);
const dialogue = definitions['pixelgirl-smiley-victory'];
const turboScene = definitions['turbo-smiley-catcher'];
function setup() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  progression.complete('arcade-1');
  const intro = new DialogueSession(definitions['pixelgirl-intro'], progression);
  for (let step = 0; step < 150 && !intro.state.finished; step++) {
    if (intro.nextMessage()) intro.deliver();
    else if (intro.advance()) continue;
    else if (intro.choices.length) intro.choose(intro.choices[0].id);
    else if (intro.activeTransfer) progression.finishTransfer(intro.activeTransfer.key);
  }
  assert.ok(intro.state.finished);
  progression.complete('pixelgirl-hello');
  return { progression, storage };
}
function receiver(progression) {
  return new ReplayReactions(progression, definitions, config);
}
function drain(reactions, now = 1000) {
  reactions.flush(now);
  for (let step = 0; step < 100; step++) {
    const due = reactions.progression.data.dialogues[dialogue.id]?.receiveDueAt;
    if (!Number.isFinite(due)) return now;
    now = Math.max(now, due);
    reactions.flush(now);
  }
  assert.fail('message loop');
}

test('Smiley completion unlocks the next event once; defeats and abandoned games do not', () => {
  const { progression } = setup();
  let completed;
  registerMiniGame('story-test', (definition, manager, sounds, onComplete) => {
    completed = onComplete;
    return { definition, element: { isConnected: true }, open() {} };
  });
  let victories = 0;
  const finishes = [];
  const launcher = new MiniGameLauncher(
    { 'smiley-catcher': { id: 'smiley-catcher', engine: 'story-test' } },
    progression,
    {},
    { unlock() {} },
    undefined,
    undefined,
    () => victories++,
    (definition, result) => finishes.push([definition.id, result]),
  );
  const file = Object.values(progression.data.files).find(
    (item) => item.launch?.game === 'smiley-catcher',
  );
  launcher.open(file);
  assert.equal(progression.current.id, 'super-mega-game');
  assert.equal(
    receiver(progression)
      .thread.getEvents()
      .some((event) => event.id === dialogue.id),
    false,
  );
  completed({ won: false, score: 0 });
  assert.equal(progression.current.id, 'super-mega-game');
  assert.equal(victories, 0);
  assert.equal(finishes.length, 1, 'loss still reports the completed mini-game');
  completed({ score: 150 });
  assert.equal(progression.current.id, 'pixelgirl-smiley-win');
  assert.equal(victories, 1);
  assert.equal(finishes.length, 2);
  completed({ score: 999 });
  assert.equal(victories, 1);
  assert.equal(progression.data.results['super-mega-game'].score, 150);
  const reactions = receiver(progression);
  const before = reactions.thread.state.history.length;
  drain(reactions);
  assert.deepEqual(
    reactions.thread.state.history.slice(before).map((entry) => entry.text),
    ['AAAAAA', 'ALOOOOORS ???', "t'as survécu à l'attaque des smileys ????"],
  );
  assert.equal(reactions.thread.availableResponses[0].choices.length, 3);
});

test('deleting the received game blocks new launches but an already open run can still win', () => {
  const { progression } = setup();
  const filesystem = new VirtualFilesystem(progression);
  const file = Object.values(progression.data.files).find(
    (item) => item.launch?.game === 'smiley-catcher',
  );
  let completeRun;
  registerMiniGame('story-file-guard-test', (definition, manager, sounds, onComplete) => {
    completeRun = onComplete;
    return { definition, element: { isConnected: true }, open() {} };
  });
  let victories = 0;
  const launcher = new MiniGameLauncher(
    { 'smiley-catcher': { id: 'smiley-catcher', engine: 'story-file-guard-test' } },
    progression,
    {},
    { unlock() {} },
    undefined,
    undefined,
    () => victories++,
    undefined,
    (candidate) => filesystem.exists(virtualFileId('downloads', candidate.name)),
  );

  const activeGame = launcher.open(file);
  assert.ok(activeGame);
  assert.equal(filesystem.deleteFile(virtualFileId('downloads', file.name)).ok, true);
  assert.equal(launcher.open(file), null, 'deleted file cannot start or reopen a game');
  assert.equal(activeGame.element.isConnected, true, 'deleting its file does not close a running game');
  completeRun({ score: 42 });
  assert.equal(progression.data.completed.includes('super-mega-game'), true);
  assert.equal(progression.data.results['super-mega-game'].score, 42);
  assert.equal(progression.current.id, 'pixelgirl-smiley-win');
  assert.equal(victories, 1);
  assert.equal(filesystem.exists(virtualFileId('downloads', file.name)), false);
});

test('Turb0 scene 3 keeps its three opening branches and resumes its shared dialogue after reload', () => {
  validateDialogue(turboScene);
  assert.equal(turboScene.contact.id, 'turbo');
  assert.equal(turboScene.contact.nickname, 'Turb0');
  const expected = [
    ["c'est toi le noob mdr", ["eh oh !!"]],
    [
      'attends mais toi aussi tu vois mon écran ?',
      ['bah ouais je voyais ton jeu mdr', 'pourquoi tu demandes ça ???'],
    ],
    ['ahah laisse moi tranquille', ['MDRRRR même pas en rêve']],
  ];
  for (const [branchIndex, [answer, replies]] of expected.entries()) {
    const { progression, storage } = setup();
    const thread = new ConversationThread('turbo', progression, () => [turboScene]);
    const session = new DialogueSession(turboScene, progression);
    assert.equal(session.nextMessage().text, 'mdrrrr noob');
    session.deliver();
    const offered = session.choices;
    const choice = offered.find((item) => item.text === answer);
    assert.ok(choice);
    session.choose(choice.id);
    for (
      let step = 0;
      step < 10 &&
      (session.state.node !== 'hobbies' ||
        session.state.cursor < turboScene.nodes.hobbies.messages.length);
      step++
    ) {
      const message = session.nextMessage();
      if (message) session.deliver();
      else if (!session.advance()) break;
    }
    const selected = new DialogueSession(turboScene, progression);
    assert.deepEqual(
      selected.state.transcript
        .filter((message) => message.speaker === 'contact')
        .map((m) => m.text),
      ['mdrrrr noob', ...replies, 'sinon tu joues a quoi en ce moment ?'],
    );
    assert.deepEqual(selected.choices.map((item) => item.text), [
      'un peu a tout mdr',
      'surtout aux jeux sur internet',
      'pas grand chose en vrai',
    ]);
    const firstChoice = selected.choices[branchIndex];
    selected.choose(firstChoice.id);
    while (
      selected.state.node !== 'computer-life' ||
      selected.state.cursor < turboScene.nodes['computer-life'].messages.length
    ) {
      const message = selected.nextMessage();
      if (message) selected.deliver();
      else assert.equal(selected.advance(), true);
    }
    assert.deepEqual(selected.choices.map((item) => item.text), [
      'mdrrr pareil',
      'tu fais que jouer ?',
      'ils ont ptet raison xD',
    ]);
    selected.choose(selected.choices[branchIndex].id);
    while (
      selected.state.node !== 'pixelgirl-links' ||
      selected.state.cursor < turboScene.nodes['pixelgirl-links'].messages.length
    ) {
      const message = selected.nextMessage();
      if (message) selected.deliver();
      else assert.equal(selected.advance(), true);
    }
    assert.deepEqual(selected.choices.map((item) => item.text), [
      'ptdrrr envoie',
      "elle a l'air marrante la vidéo",
      'vous vous connaissez depuis longtemps ?',
    ]);
    assert.deepEqual(selected.choices.map((item) => item.id), [
      'cat-video-send',
      'video-funny',
      'friends-long',
    ]);
    selected.choose(selected.choices[branchIndex].id);
    while (!selected.state.finished) {
      const message = selected.nextMessage();
      if (message) selected.deliver();
      else selected.advance();
    }
    thread.sync();
    const history = structuredClone(thread.state.history);
    const restored = new Progression(story, storage);
    const restoredThread = new ConversationThread('turbo', restored, () => [turboScene]);
    assert.deepEqual(restoredThread.sync(), history);
    assert.equal(new DialogueSession(turboScene, restored).state.finished, true);
    assert.deepEqual(
      new DialogueSession(turboScene, restored).state.transcript.map((message) => message.text),
      selected.state.transcript.map((message) => message.text),
    );
  }
});

test('Turb0 first message is delivered after the saved two-second delay exactly once', () => {
  const { progression } = setup();
  const thread = new ConversationThread('turbo', progression, () => [turboScene]);
  thread.schedule(turboScene, 1000);
  assert.deepEqual(thread.receive(2999), []);
  assert.deepEqual(thread.receive(3000), [turboScene]);
  assert.equal(thread.state.history.at(-1).text, 'mdrrrr noob');
  assert.deepEqual(thread.receive(4000), []);
  assert.equal(thread.state.history.filter((message) => message.text === 'mdrrrr noob').length, 1);
});

test('an in-progress old Turb0 conversation migrates without losing its checkpoint or history', () => {
  const { progression } = setup();
  const oldReply = turboScene.nodes['noob-reply'].messages[0].text;
  progression.data.dialogues[turboScene.id] = {
    revision: 1,
    node: 'noob-reply',
    cursor: 1,
    transcript: [
      { speaker: 'contact', text: 'mdrrrr noob', receivedAt: 1 },
      { speaker: 'player', text: "c'est toi le noob mdr", receivedAt: 2 },
      { speaker: 'contact', text: oldReply, receivedAt: 3 },
    ],
    finished: false,
  };
  progression.data.conversations.turbo = {
    version: 1,
    history: progression.data.dialogues[turboScene.id].transcript.map((message, index) => ({
      ...message,
      key: `${turboScene.id}:1:${index}`,
    })),
    unread: [`${turboScene.id}:1:2`],
    activeEvent: turboScene.id,
    pendingEvents: [],
  };
  new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: { update() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
  });
  const saved = progression.data.dialogues[turboScene.id];
  assert.equal(saved.revision, turboScene.revision);
  assert.equal(saved.node, 'noob-reply');
  assert.equal(saved.cursor, 1);
  assert.equal(saved.transcript.length, 3);
  assert.equal(progression.data.dialogueArchives[`${turboScene.id}:1`].transcript.length, 3);
  assert.deepEqual(
    progression.data.conversations.turbo.history.map((entry) => entry.key),
    saved.transcript.map((_, index) => `${turboScene.id}:${turboScene.revision}:${index}`),
  );
  assert.deepEqual(progression.data.conversations.turbo.unread, [`${turboScene.id}:${turboScene.revision}:2`]);
  const restoredSession = new DialogueSession(turboScene, progression);
  assert.deepEqual(restoredSession.choices.map((choice) => choice.text), []);
  assert.equal(restoredSession.nextMessage(), null);
  assert.equal(restoredSession.advance(), true);
  assert.equal(restoredSession.state.node, 'hobbies');
});

test('all eight sequences, all 31 branches, joins and ten choices survive restarted receivers', () => {
  validateDialogue(dialogue);
  const covered = new Set();
  for (let route = 0; route < 4; route++) {
    let { progression, storage } = setup();
    progression.complete('super-mega-game', { score: 250 });
    let reactions = receiver(progression),
      now = 1000,
      questions = 0;
    const initial = reactions.thread.state.history.map((entry) => entry.key);
    while (!progression.data.dialogues[dialogue.id]?.finished) {
      now = drain(reactions, now);
      if (progression.data.dialogues[dialogue.id].finished) break;
      const groups = reactions.thread.availableResponses;
      assert.equal(groups.length, 1);
      assert.equal(groups[0].definition.id, dialogue.id);
      const choice = groups[0].choices[route % groups[0].choices.length];
      covered.add(choice.id);
      questions++;
      const session = new DialogueSession(dialogue, progression);
      session.choose(choice.id);
      reactions.thread.sync();
      reactions.thread.schedule(dialogue, now);
      assert.ok(reactions.thread.isReceiving(dialogue.id));
      const savedHistory = structuredClone(reactions.thread.state.history);
      progression = new Progression(story, storage);
      reactions = receiver(progression);
      assert.deepEqual(reactions.thread.state.history, savedHistory);
      assert.ok(questions <= 10);
    }
    assert.equal(questions, 10);
    assert.equal(reactions.thread.pendingResponses.length, 0);
    const history = reactions.thread.state.history;
    assert.deepEqual(
      history.slice(0, initial.length).map((entry) => entry.key),
      initial,
    );
    assert.equal(new Set(history.map((entry) => entry.key)).size, history.length);
    assert.equal(history.at(-1).text, 'bon jreviens :3');
    const state = progression.data.dialogues[dialogue.id];
    assert.equal(state.transcript.filter((message) => message.speaker === 'player').length, 10);
    assert.equal(
      Object.keys(progression.data.choiceOffers).filter((key) => key.startsWith(dialogue.id))
        .length,
      10,
    );
    assert.ok(
      [':)', ':|', '>:)', 'pourquoi tu me poses cette question MDR'].includes(
        progression.data.flags.pixelgirlSmiley,
      ),
    );
    assert.ok(progression.data.flags.pixelgirlDrawingReaction);
    assert.ok(progression.data.flags.pixelgirlMeetingReaction);
    const connected = [];
    const effects = new DialogueEvents(progression, definitions, (id) => connected.push(id));
    effects.update(now);
    assert.equal(progression.current, null);
    assert.deepEqual(connected, []);
    assert.equal(reactions.thread.activeDefinition.contact.status, 'En ligne');
    assert.equal(reactions.thread.activeDefinition.completion.stayOnline, true);
    effects.update(now + 1999);
    assert.deepEqual(connected, []);
    effects.update(now + 2000);
    assert.deepEqual(connected, ['turbo']);
    const resumed = new Progression(story, storage);
    const effectsAfterRestart = new DialogueEvents(resumed, definitions, (id) =>
      connected.push(id),
    );
    effectsAfterRestart.update(now + 2000, false);
    assert.deepEqual(connected, ['turbo']);
    effectsAfterRestart.update(now + 2000);
    effectsAfterRestart.update(now + 5000);
    assert.deepEqual(connected, ['turbo']);
    assert.ok(
      visibleContacts(
        definitions,
        resumed.data.unlockedConversations,
        undefined,
        resumed.data.contactConnections,
      ).some((contact) => contact.id === 'turbo' && contact.online),
    );
    const after = new Progression(story, storage);
    new DialogueEvents(after, definitions, (id) => connected.push(id)).update(now + 6000);
    assert.deepEqual(connected, ['turbo']);
    assert.equal(after.current, null);
    assert.equal(receiver(after).thread.state.history.length, history.length);
  }
  assert.equal(covered.size, 31);
});

test('only PixelGirl first validated response connects Turb0, and it persists without duplicate arrivals', () => {
  const { progression, storage } = setup();
  progression.complete('super-mega-game');
  const previousChoices = progression.data.choices.length;
  const reactions = receiver(progression);
  const now = 5000;
  reactions.thread.schedule(dialogue, now);
  const openingMessages = dialogue.nodes[dialogue.start].messages;
  while (progression.data.dialogues[dialogue.id].cursor < openingMessages.length) {
    reactions.flush(progression.data.dialogues[dialogue.id].receiveDueAt);
  }
  const openingHistory = reactions.thread.sync();
  assert.equal(openingHistory.at(-1).text, openingMessages.at(-1).text);
  assert.equal(progression.data.choices.length, previousChoices);

  const connected = [];
  const effects = new DialogueEvents(progression, definitions, (id) => connected.push(id), {
    deferredConnectionDialogues: [dialogue.id],
  });
  effects.update(now + 10_000);
  assert.deepEqual(connected, []);
  assert.equal(progression.data.contactConnections?.turbo, undefined);

  const session = new DialogueSession(dialogue, progression);
  const choice = session.choices[0];
  assert.ok(choice);
  const view = {
    onChoiceValidated: (definition, { nodeId }) => {
      if (definition.id === dialogue.id && nodeId === definition.start)
        effects.triggerConnection('turbo', now + 10_001);
    },
  };
  ConversationWindow.prototype.chooseResponse.call(view, dialogue, session, choice.id);
  assert.deepEqual(connected, []);
  assert.deepEqual(progression.data.contactConnections.turbo, {
    status: 'pending',
    dueAt: now + 12_001,
  });
  assert.equal(
    progression.data.dialogues[dialogue.id].transcript.length,
    openingMessages.length + 1,
  );
  assert.equal(progression.data.choices.length, previousChoices + 1);
  effects.update(now + 12_000);
  assert.deepEqual(connected, []);
  effects.update(now + 12_001);
  assert.deepEqual(connected, ['turbo']);
  assert.equal(effects.triggerConnection('turbo', now + 20_001), false);
  const restored = new Progression(story, storage);
  new DialogueEvents(restored, definitions, (id) => connected.push(id), {
    deferredConnectionDialogues: [dialogue.id],
  }).update(20_000);
  assert.deepEqual(connected, ['turbo']);
  assert.equal(restored.data.contactConnections.turbo.status, 'online');
});

test('typing pulse, silent pause and slower final sections use saved timing without fake messages', () => {
  const { progression } = setup();
  progression.complete('super-mega-game');
  const session = new DialogueSession(dialogue, progression);
  session.state.node = 's3';
  session.state.cursor = 1;
  session.persist();
  const reactions = receiver(progression);
  reactions.thread.schedule(dialogue, 1000);
  const historyLength = reactions.thread.state.history.length;
  assert.equal(reactions.thread.typingContact(1349), null);
  assert.equal(reactions.thread.typingContact(1350).nickname, 'xX_PixelGirl_Xx');
  assert.equal(reactions.thread.typingContact(2000), null);
  reactions.flush(4299);
  assert.equal(reactions.thread.state.history.length, historyLength);
  reactions.flush(4300);
  assert.equal(reactions.thread.state.history.at(-1).text, 'bon');
  assert.ok(
    dialogue.nodes.s7.messages.every(
      (message) => message.delayMs > dialogue.nodes.s1.messages[0].delayMs,
    ),
  );
});

test('legacy completed Smiley saves resume only the appended conversation, preserving messages and results', () => {
  const { progression, storage } = setup();
  progression.complete('super-mega-game', { score: 120 });
  progression.data.current = null;
  progression.data.unlockedConversations = ['pixelgirl-intro'];
  progression.save();
  const before = structuredClone(progression.data);
  const restored = new Progression(story, storage);
  assert.equal(restored.current.id, 'pixelgirl-smiley-win');
  assert.deepEqual(restored.data.results, before.results);
  assert.deepEqual(restored.data.dialogues, before.dialogues);
  assert.deepEqual(restored.data.choices, before.choices);
  drain(receiver(restored));
  assert.equal(restored.data.dialogues[dialogue.id].cursor, 3);
  assert.equal(restored.data.dialogues['pixelgirl-intro'].finished, true);
});

test('a level-one replay does not hide the later question or change PixelGirl final presence', () => {
  const { progression } = setup();
  progression.complete('super-mega-game');
  const reactions = receiver(progression);
  drain(reactions, 1000);
  const offered = structuredClone(reactions.thread.availableResponses[0].choices);
  reactions.launch(10000);
  reactions.flush(20000);
  assert.deepEqual(reactions.thread.availableResponses[0].choices, offered);
  assert.equal(reactions.thread.availableResponses[0].definition.id, dialogue.id);
  const session = new DialogueSession(dialogue, progression);
  session.state.node = 's8-common-1';
  session.state.cursor = 1;
  session.state.finished = true;
  session.persist();
  assert.equal(reactions.thread.activeDefinition.id, dialogue.id);
});

test('corrupt optional connection metadata preserves the rest of the saved run', () => {
  const { progression, storage } = setup();
  progression.data.contactConnections = { turbo: { status: 'pending', dueAt: 'invalid' } };
  progression.save();
  const restored = new Progression(story, storage);
  assert.equal(restored.corrupt, undefined);
  assert.deepEqual(restored.data.contactConnections, {});
  assert.deepEqual(restored.data.choices, progression.data.choices);
  assert.deepEqual(restored.data.dialogues, progression.data.dialogues);
});
