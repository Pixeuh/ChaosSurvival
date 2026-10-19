import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { VirtualFilesystem } from '../src/story/virtual-filesystem.js';
import { createGame, drainGameEvents, updateGame } from '../src/minigames/bomb-arena/engine.js';
import { createDevelopmentProgressionSandbox, installDevelopmentBombArenaShortcut } from '../src/dev/finish-shortcut.js';
import { createBombArenaHandoffRetrier } from '../src/story/bomb-arena-handoff.js';
import { BOMB_ARENA_RESULTS_DISPLAY_MS, createResultsAutoReturn } from '../src/minigames/bomb-arena/view.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const group = read('../src/dialogues/pixelgirl-super-plombier-group.json');
const postmatch = read('../src/dialogues/bomb-arena-postmatch.json');
const definitions = Object.fromEntries(readdirSync(new URL('../src/dialogues/', import.meta.url))
  .filter((file) => file.endsWith('.json'))
  .map((file) => { const dialogue = read(`../src/dialogues/${file}`); return [dialogue.id, dialogue]; }));

function createStoryHarness(progression, now = () => Date.now()) {
  let thread;
  const contact = { id: 'plumber-group', available: true, online: true };
  const orchestrator = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: {},
    getContact: (id) => id === 'plumber-group' ? contact : null,
    prepareContact: () => null,
    showConnectionNotification() {},
    getGroupThread: () => thread,
    showGroupNotification: () => true,
    onGroupMessage() {},
    now,
  });
  const events = () => [group, ...(orchestrator.bombArenaPostMatchAvailable() ? [postmatch] : [])];
  thread = new ConversationThread('plumber-group', progression, events);
  return { orchestrator, thread, events };
}

function advanceRealBombArenaMatch(progression, orchestrator) {
  const game = createGame({ rng: () => 0.9 });
  orchestrator.onBombArenaEvent({ type: 'match-started', difficulty: game.difficulty });
  for (let round = 1; round <= 8; round++) {
    game.phase = 'playing';
    for (const player of game.players) player.alive = player.id === 'justme';
    updateGame(game, 16);
    for (const event of drainGameEvents(game)) {
      if (event.type === 'round_completed') orchestrator.onBombArenaEvent({
        type: 'round-completed', round: event.round, winnerId: event.playerId, scores: event.scores,
      });
    }
    if (round < 8) {
      game.messageMs = 0;
      updateGame(game, 1);
      drainGameEvents(game);
    }
  }
  assert.equal(game.phase, 'match-end');
  assert.equal(game.round, 8);
  assert.equal(game.matchWinnerId, 'justme');
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'shortcut-session-1', difficulty: game.difficulty,
    winnerId: game.matchWinnerId, scores: game.wins, roundsPlayed: game.round,
  }), true);
  return game;
}

test('Ctrl+Shift+B isolated save advances the real group offer, persists eight-round results, retries Messenger, and sends the postmatch branch', () => {
  const normalValues = new Map();
  const normalStorage = {
    getItem: (key) => normalValues.get(key) ?? null,
    setItem: (key, value) => normalValues.set(key, value),
  };
  const progression = new Progression(story, normalStorage);
  progression.begin();
  progression.data.flags.keepNormalRun = 'intact';
  progression.save();
  const originalSave = normalStorage.getItem('chaos-survival-story-v1');
  const sandbox = createDevelopmentProgressionSandbox(progression);
  let onKey;
  const shortcutCleanup = installDevelopmentBombArenaShortcut({
    addEventListener: (_type, callback) => { onKey = callback; },
    removeEventListener: () => {},
  }, () => sandbox.enter(group));
  let prevented = false;
  onKey({ key: 'B', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false,
    target: { closest: () => null }, preventDefault: () => { prevented = true; } });
  shortcutCleanup();
  assert.equal(prevented, true, 'the real Ctrl+Shift+B handler enters the development sandbox');
  assert.equal(sandbox.active, true);
  const devStorage = progression.storage;
  let now = Date.now();
  const firstStory = createStoryHarness(progression, () => now);

  // Run the normal orchestrator and thread from the actual shortcut's intro node.
  firstStory.orchestrator.updateGroup(now);
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  assert.equal(progression.data.dialogues[group.id].node, 'bomb-arena-transfer');
  assert.ok(Number.isFinite(progression.data.bombArena.expectedAt), 'the offer arms the mandatory gate');
  assert.equal(progression.data.bombArena.status, 'NOT_STARTED');

  const archive = Object.values(progression.data.files).find((file) => file.extractable === 'bomb-arena');
  assert.ok(archive, 'the shortcut advances the normal narrative to the real ZIP offer');
  assert.equal(progression.acceptTransfer(archive.key), true);
  assert.equal(progression.startTransfer(archive.key, now), true);
  progression.finishTransfer(archive.key);
  const filesystem = new VirtualFilesystem(progression);
  assert.equal(filesystem.extractBombArena('downloads/bombarena.zip').ok, true);
  assert.equal(filesystem.exists('bomb-arena-folder/bombarena.exe'), true);
  const groupSession = new DialogueSession(group, progression);
  assert.equal(groupSession.advance(), true, 'accepted transfer advances the existing group dialogue');
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  assert.equal(progression.data.dialogues[group.id].finished, true,
    'the normal group thread finishes its post-transfer messages before match results');

  advanceRealBombArenaMatch(progression, firstStory.orchestrator);
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  assert.equal(progression.data.bombArena.sessionRoundsPlayed, 8);
  assert.equal(progression.data.bombArena.sessionWinner, 'justme');
  assert.equal(normalStorage.getItem('chaos-survival-story-v1'), originalSave, 'the real save remains untouched');

  // Reload the actual isolated save while the result-to-MSN transition is pending.
  const resumed = new Progression(story, devStorage);
  const resumedStory = createStoryHarness(resumed, () => now);
  let attempts = 0;
  let timerCallback;
  let resultCallback;
  let timerId = 0;
  const retrier = createBombArenaHandoffRetrier({
    progression: resumed,
    onBombArenaEvent: (event) => resumedStory.orchestrator.onBombArenaEvent(event),
    activateGroup: () => ++attempts > 1,
    setTimeoutFn: (callback, delay) => { assert.equal(delay, 1_000); timerCallback = callback; return ++timerId; },
    clearTimeoutFn: () => { timerCallback = null; },
  });
  const resultsTimer = createResultsAutoReturn(() => retrier.attempt(), {
    setTimeoutFn: (callback, delay) => {
      assert.equal(delay, BOMB_ARENA_RESULTS_DISPLAY_MS);
      resultCallback = callback;
      return 'results-delay';
    },
    clearTimeoutFn() {},
  });
  assert.equal(resultsTimer.start(), true, 'final results start the automatic five-second return timer');
  const elapsedResultsCallback = resultCallback;
  resultCallback = null;
  elapsedResultsCallback();
  assert.equal(resumed.data.bombArena.status, 'RESULTS_READY');
  assert.equal(attempts, 1, 'the first automatic group activation was attempted after results');
  assert.equal(retrier.scheduled, true);
  const retry = timerCallback;
  timerCallback = null;
  retry();
  assert.equal(resumed.data.bombArena.status, 'COMPLETED');
  assert.equal(attempts, 2);
  assert.equal(retrier.scheduled, false);

  assert.equal(resumedStory.orchestrator.bombArenaPostMatchAvailable(), true);
  assert.equal(resumed.data.flags.bombArenaWinner, 'justme');
  resumedStory.thread.schedule(postmatch, now);
  const incoming = resumedStory.thread.receive(now + 20_000);
  assert.ok(incoming.includes(postmatch), 'the existing group thread receives the real postmatch dialogue');
  assert.equal(resumed.data.dialogues[postmatch.id].transcript[0].text, 'AAAAAA');
  const postmatchHistoryCount = resumedStory.thread.state.history.filter((message) => message.eventId === postmatch.id).length;
  assert.ok(postmatchHistoryCount > 0, 'the branch is written to the existing group conversation history');

  const reloadedAgain = new Progression(story, devStorage);
  const againStory = createStoryHarness(reloadedAgain, () => now + 30_000);
  assert.equal(againStory.orchestrator.bombArenaPostMatchAvailable(), true);
  const restoredHistory = againStory.thread.state.history;
  assert.equal(restoredHistory.filter((message) => message.eventId === postmatch.id).length, postmatchHistoryCount,
    'reloading restores the same transcript without adding duplicate messages');
  assert.equal(reloadedAgain.data.dialogues[postmatch.id].transcript[0].text, 'AAAAAA');
  assert.equal(sandbox.restore(), true);
  assert.equal(progression.data.flags.keepNormalRun, 'intact');
  assert.equal(normalStorage.getItem('chaos-survival-story-v1'), originalSave);
});
