import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression, validateStory } from '../src/story/progression.js';
import { DialogueSession, validateDialogue, matches } from '../src/story/dialogue.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const dialogue = JSON.parse(
  readFileSync(new URL('../src/dialogues/pixelgirl-intro.json', import.meta.url)),
);
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
function drain(session) {
  for (let i = 0; i < 150; i++) {
    if (session.nextMessage()) {
      session.deliver();
      continue;
    }
    if (!session.advance()) return;
  }
  assert.fail('automatic loop');
}
function setup(storage = memory()) {
  const progression = new Progression(story, storage);
  progression.complete('arcade-1');
  return { storage, progression, session: new DialogueSession(dialogue, progression) };
}

test('all 81 choice paths merge into the common story and deliver the same mini-game', () => {
  for (let a = 1; a <= 3; a++)
    for (let b = 1; b <= 3; b++)
      for (let c = 1; c <= 3; c++)
        for (let d = 1; d <= 3; d++) {
          const { session, progression } = setup();
          for (const id of [`greeting-${a}`, `nickname-${b}`, `table-${c}`, `game-${d}`]) {
            drain(session);
            assert.equal(session.choices.length, 3);
            session.choose(id);
          }
          drain(session);
          assert.ok(session.activeTransfer);
          progression.finishTransfer(session.activeTransfer.key);
          drain(session);
          assert.equal(session.state.finished, true);
          assert.equal(progression.data.choices.length, 4);
          assert.ok(
            progression.data.choices.every(
              (choice) => choice.offered.length === 3 && choice.unselected.length === 2,
            ),
          );
          assert.equal(
            session.state.transcript.filter((message) => message.speaker === 'player').length,
            4,
          );
          assert.ok(session.state.transcript.at(-1).text.includes('paint'));
        }
});

test('BombArena milestones and match results persist once while old saves gain safe defaults', () => {
  const storage = memory();
  const progression = new Progression(story, storage);
  progression.data.flags.keepThisChoice = true;
  delete progression.data.bombArena;
  progression.save();

  const restored = new Progression(story, storage);
  assert.equal(restored.data.flags.keepThisChoice, true);
  assert.deepEqual(restored.data.bombArena, {
    status: 'NOT_STARTED',
    expectedAt: null,
    returnedToMessengerAt: null,
    completedRounds: 0,
    nextRound: 1,
    nextDifficulty: 'PRO',
    overtimeRounds: 0,
    roundScores: { justme: 0, pixelgirl: 0, turbo: 0, luna: 0 },
    sessionWinner: null,
    sessionScores: null,
    sessionRoundsPlayed: null,
    nextReminderAt: null,
    reminderCount: 0,
    reminderSalvoCount: 0,
    reminderLastExtraVariant: null,
    interruptionCount: 0,
    reminderBurstRemaining: 0,
    reminderBurstSent: 0,
    reminderBurstNextAt: null,
    reminderBurstSalvo: null,
    reminderBurstSequence: null,
    reminderBurstMessageCount: 0,
    downloadedAt: null,
    extractedAt: null,
    firstLaunchedAt: null,
    firstGameStartedAt: null,
    firstGameCompletedAt: null,
    firstGameDifficulty: null,
    firstGameWinner: null,
    firstGameScores: null,
    firstGameRoundsPlayed: null,
    gamesPlayed: 0,
    justMeWins: 0,
    defeats: 0,
    lastDifficulty: null,
    lastWinner: null,
    lastScores: null,
    lastRoundsPlayed: null,
    completedMatchIds: [],
  });

  assert.equal(restored.recordBombArenaEvent({ type: 'downloaded' }, 10), true);
  assert.equal(restored.recordBombArenaEvent({ type: 'extracted' }, 20), true);
  assert.equal(restored.recordBombArenaEvent({ type: 'launched' }, 30), true);
  assert.equal(restored.recordBombArenaEvent({ type: 'match-started', difficulty: 'PRO' }, 40), true);
  const narrativeBefore = structuredClone({ current: restored.data.current, completed: restored.data.completed });
  assert.equal(restored.recordBombArenaEvent({
    type: 'match-completed', matchId: 'match-one', difficulty: 'PGM', winnerId: 'pixelgirl', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 3, turbo: 2, luna: 2 },
  }, 50), true);
  assert.equal(restored.recordBombArenaEvent({
    type: 'match-completed', matchId: 'match-one', difficulty: 'PGM', winnerId: 'pixelgirl', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 3, turbo: 2, luna: 2 },
  }, 51), false, 'a duplicate result cannot count twice');
  assert.equal(restored.recordBombArenaEvent({
    type: 'match-completed', matchId: 'match-two', difficulty: 'PGM', winnerId: 'justme', roundsPlayed: 9,
    scores: { justme: 4, pixelgirl: 3, turbo: 2, luna: 0 },
  }, 60), true);

  const saved = new Progression(story, storage);
  assert.equal(saved.data.bombArena.downloadedAt, 10);
  assert.equal(saved.data.bombArena.extractedAt, 20);
  assert.equal(saved.data.bombArena.firstLaunchedAt, 30);
  assert.equal(saved.data.bombArena.firstGameStartedAt, 40);
  assert.equal(saved.data.bombArena.firstGameCompletedAt, 50);
  assert.equal(saved.data.bombArena.firstGameWinner, 'pixelgirl');
  assert.equal(saved.data.bombArena.firstGameDifficulty, 'PRO');
  assert.deepEqual(saved.data.bombArena.firstGameScores, { justme: 1, pixelgirl: 3, turbo: 2, luna: 2 });
  assert.equal(saved.data.bombArena.firstGameRoundsPlayed, 8);
  assert.equal(saved.data.bombArena.gamesPlayed, 2);
  assert.equal(saved.data.bombArena.justMeWins, 1);
  assert.equal(saved.data.bombArena.defeats, 1);
  assert.equal(saved.data.bombArena.lastDifficulty, 'PGM');
  assert.equal(saved.data.bombArena.lastWinner, 'justme');
  assert.deepEqual(saved.data.bombArena.lastScores, { justme: 4, pixelgirl: 3, turbo: 2, luna: 0 });
  assert.equal(saved.data.bombArena.lastRoundsPlayed, 9);
  assert.deepEqual({ current: saved.data.current, completed: saved.data.completed }, narrativeBefore);
});

test('explorer preferences default safely for old saves and persist without changing file names', () => {
  const storage = memory();
  const progression = new Progression(story, storage);
  assert.equal(progression.data.explorerPreferences.hideKnownExtensions, true);
  progression.data.explorerPreferences.hideKnownExtensions = false;
  progression.data.explorerPreferences.favorites = ['computer', 'music'];
  assert.equal(progression.save(), true);

  const restored = new Progression(story, storage);
  assert.equal(restored.data.explorerPreferences.hideKnownExtensions, false);
  assert.deepEqual(restored.data.explorerPreferences.favorites, ['computer', 'music']);
  assert.equal(restored.data.explorerPreferences.viewMode, 'icons');

  const saved = JSON.parse(storage.getItem('chaos-survival-story-v1'));
  delete saved.explorerPreferences;
  storage.setItem('chaos-survival-story-v1', JSON.stringify(saved));
  assert.equal(new Progression(story, storage).data.explorerPreferences.hideKnownExtensions, true);
});

test('BombArena checkpoints completed rounds atomically and the next session resumes with saved scores', () => {
  const storage = memory();
  const progression = new Progression(story, storage);
  progression.recordBombArenaEvent({ type: 'expected' }, 100);
  progression.recordBombArenaEvent({ type: 'match-started', difficulty: 'PRO' }, 200);
  assert.equal(progression.recordBombArenaEvent({
    type: 'round-completed', round: 1, winnerId: 'justme',
    scores: { justme: 1, pixelgirl: 0, turbo: 0, luna: 0 },
  }, 300), true);
  assert.equal(progression.recordBombArenaEvent({
    type: 'round-completed', round: 1, winnerId: 'turbo',
    scores: { justme: 0, pixelgirl: 0, turbo: 1, luna: 0 },
  }, 301), false, 'a repeated checkpoint cannot overwrite the finalized round');

  const restored = new Progression(story, storage);
  assert.equal(restored.data.bombArena.status, 'IN_PROGRESS');
  assert.equal(restored.data.bombArena.completedRounds, 1);
  assert.equal(restored.data.bombArena.nextRound, 2);
  assert.equal(restored.data.bombArena.nextDifficulty, 'PRO');
  assert.deepEqual(restored.data.bombArena.roundScores, { justme: 1, pixelgirl: 0, turbo: 0, luna: 0 });
});

test('BombArena blocks story progression until results are returned to Messenger, regardless of winner', () => {
  const progression = new Progression(story, memory());
  progression.recordBombArenaEvent({ type: 'expected' }, 10);
  assert.equal(progression.isBombArenaBlockingStory(), true);
  assert.equal(progression.complete('arcade-1'), false);
  assert.equal(progression.recordBombArenaEvent({
    type: 'match-completed', matchId: 'mandatory-match', difficulty: 'PGM', winnerId: 'luna', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 2, turbo: 2, luna: 3 },
  }, 20), true);
  assert.equal(progression.isBombArenaBlockingStory(), true, 'the result screen alone does not unlock the story');
  assert.equal(progression.recordBombArenaEvent({ type: 'returned-to-messenger' }, 30), true);
  assert.equal(progression.isBombArenaBlockingStory(), false);
  assert.equal(progression.data.bombArena.status, 'COMPLETED');
});

test('BombArena result recording ignores abandonment and invalid or incomplete results', () => {
  const progression = new Progression(story, memory());
  assert.equal(progression.recordBombArenaEvent({ type: 'match-started', difficulty: 'PRO' }, 100), true);
  assert.equal(progression.recordBombArenaEvent({ type: 'match-abandoned' }, 200), false);
  assert.equal(progression.recordBombArenaEvent({
    type: 'match-completed', matchId: 'bad', difficulty: 'PGM', winnerId: null, roundsPlayed: 8,
  }, 300), false);
  assert.equal(progression.data.bombArena.gamesPlayed, 0);
  assert.equal(progression.data.bombArena.firstGameCompletedAt, null);
});

test('proposals are saved before selection, and the 500ms echo never enters the transcript', () => {
  const { session, progression, storage } = setup();
  drain(session);
  session.offerChoices();
  const key = 'pixelgirl-intro:first-contact';
  assert.equal(new Progression(story, storage).data.choiceOffers[key].length, 3);
  session.choose('greeting-1');
  assert.equal(session.takeEcho().durationMs, 500);
  assert.equal(session.takeEcho(), null);
  assert.equal(
    session.state.transcript.filter((message) => message.speaker === 'player').length,
    1,
  );
  assert.ok(
    !session.state.transcript.some(
      (message) => message.text === 'j?ai surtout cliqu? au hasard mdr',
    ),
  );
  assert.equal(progression.data.anomalies[key].choice, 'greeting-2');
  const resumed = new DialogueSession(dialogue, new Progression(story, storage));
  assert.equal(resumed.takeEcho(), undefined);
  assert.equal(
    matches(
      {
        choice: {
          dialogue: 'pixelgirl-intro',
          node: 'first-contact',
          id: 'greeting-2',
          selected: false,
        },
      },
      {},
      progression.data.choices,
    ),
    true,
  );
  assert.equal(
    matches(
      {
        choice: {
          dialogue: 'pixelgirl-intro',
          node: 'first-contact',
          id: 'greeting-1',
          selected: false,
        },
      },
      {},
      progression.data.choices,
    ),
    false,
  );
});

test('refusing repeatedly remains playable and accepting later unlocks the file', () => {
  const { session, progression } = setup();
  for (const id of ['greeting-2', 'nickname-2', 'table-2', 'game-2']) {
    drain(session);
    session.choose(id);
  }
  drain(session);
  for (let i = 0; i < 3; i++) {
    assert.equal(session.activeTransfer.status, 'pending');
    session.declineTransfer(session.activeTransfer.key);
    drain(session);
    assert.equal(session.state.node, 'offer-again');
  }
  assert.equal(
    Object.values(progression.data.files).filter((file) => file.status === 'complete').length,
    0,
  );
  progression.finishTransfer(session.activeTransfer.key);
  drain(session);
  assert.equal(session.state.finished, true);
  const received = Object.values(progression.data.files).filter(
    (file) => file.status === 'complete',
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].name, 'SUPER_MEGA_GAME.exe');
  assert.equal(received[0].launch.game, 'smiley-catcher');
  progression.complete('pixelgirl-hello');
  assert.equal(progression.current.type, 'minigame');
  progression.complete('super-mega-game', { score: 100 });
  assert.equal(progression.current.id, 'pixelgirl-smiley-win');
});

test('a new app session resumes partial messages, choices, offered alternatives and transfers', () => {
  const { session, progression, storage } = setup();
  session.deliver();
  let restored = new DialogueSession(dialogue, new Progression(story, storage));
  assert.equal(restored.state.cursor, 1);
  drain(restored);
  restored.choose('greeting-3');
  restored = new DialogueSession(dialogue, new Progression(story, storage));
  assert.equal(restored.state.node, 'spectator');
  assert.equal(restored.progression.data.choices[0].unselected.length, 2);
  assert.throws(() => restored.choose('greeting-3'));
});

test('old completed introductions keep their history and never replay after a JSON revision', () => {
  const storage = memory();
  storage.setItem(
    'chaos-survival-story-v1',
    JSON.stringify({
      version: 1,
      current: null,
      completed: ['arcade-1', 'pixelgirl-hello'],
      flags: { musicTaste: 'pop' },
      choices: [{ key: 'pixelgirl-intro:hello', choice: 'sparkles' }],
      dialogues: {
        'pixelgirl-intro': {
          node: 'hello',
          revision: 1,
          cursor: 3,
          finished: true,
          transcript: [{ speaker: 'contact', text: 'heyyy !!' }],
        },
      },
      results: {},
    }),
  );
  const progression = new Progression(story, storage);
  assert.equal(progression.current, null);
  const session = new DialogueSession(dialogue, progression);
  assert.equal(session.state.node, 'hello');
  assert.equal(session.state.finished, true);
  assert.equal(session.nextMessage(), null);
  assert.equal(session.state.transcript[0].text, 'heyyy !!');
  assert.equal(progression.data.choices.length, 1);
  assert.equal(progression.data.dialogueArchives['pixelgirl-intro:1'].transcript.length, 1);
});

test('invalid transitions, duplicate IDs, timers and automatic loops are rejected', () => {
  let bad = structuredClone(dialogue);
  bad.nodes['first-contact'].choices[0].next = 'constructor';
  assert.throws(() => validateDialogue(bad));
  bad = structuredClone(dialogue);
  bad.nodes['first-contact'].messages[0].delayMs = -1;
  assert.throws(() => validateDialogue(bad));
  bad = structuredClone(dialogue);
  bad.nodes.autographs.next = 'autographs';
  assert.throws(() => validateDialogue(bad));
  bad = structuredClone(dialogue);
  bad.nodes.introduction.choices[0].id = 'greeting-1';
  assert.throws(() => validateDialogue(bad));
  assert.throws(() => validateStory({ ...story, start: 'missing' }));
  const fallback = new Progression(story, {
    getItem: () => '{broken',
    setItem: () => {
      throw Error('blocked');
    },
  });
  assert.equal(fallback.current.id, 'arcade-1');
});

test('outgoing fictional files use the same transfer system without creating a received desktop item', () => {
  const custom = {
    ...dialogue,
    id: 'outgoing',
    start: 'send',
    nodes: {
      send: {
        messages: [
          {
            speaker: 'player',
            type: 'file',
            file: { id: 'photo', name: 'photo.jpg', sizeLabel: '12 Ko' },
            delayMs: 0,
            typingMs: 0,
          },
        ],
        end: true,
      },
    },
  };
  const { progression } = setup();
  const session = new DialogueSession(custom, progression);
  session.deliver();
  const file = Object.values(progression.data.files)[0];
  assert.equal(file.direction, 'send');
  progression.finishTransfer(file.key);
  assert.equal(file.status, 'complete');
});

test('PixelGirl describes the received executable with the exact requested wording', () => {
  const messages = Object.values(dialogue.nodes).flatMap((node) => node.messages);
  assert.ok(
    messages.some((message) => message.text === "j'ai un ami qui collectionne les ptits jeux nuls"),
  );
  assert.ok(!messages.some((message) => /jeux flash/i.test(message.text ?? '')));
});
