import test from 'node:test';
import assert from 'node:assert/strict';
import story from '../src/config/story.json' with { type: 'json' };
import intro from '../src/dialogues/pixelgirl-intro.json' with { type: 'json' };
import { DialogueSession, validateDialogue } from '../src/story/dialogue.js';
import { Progression } from '../src/story/progression.js';
import {
  LEGACY_PLAYER_IDENTITY,
  normalizePlayerIdentity,
  normalizePlayerNickname,
  resolvePlayerText,
  validatePlayerNickname,
} from '../src/story/player-identity.js';
import { createGame } from '../src/minigames/bomb-arena/engine.js';
import { createBombArenaChat } from '../src/minigames/bomb-arena/chat-system.js';
import { applyPlayerIdentity, playerIdentity } from '../src/ui/player-identity.js';
import { buddyIdentitySelection } from '../src/ui/buddy.js';

const STORAGE_KEY = 'chaos-survival-story-v1';
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function inputDialogue() {
  return {
    version: 1,
    id: 'identity-input-test',
    contact: { id: 'pixelgirl', name: 'PixelGirl', nickname: 'PixelGirl' },
    player: { nickname: 'Moi' },
    start: 'ask',
    nodes: {
      ask: {
        messages: [{ speaker: 'contact', text: 'Ton pseudo ?', delayMs: 0, typingMs: 0 }],
        input: {
          id: 'nickname', validator: 'playerNickname', action: 'setPlayerNickname',
          invalidMessage: '3 à 16 lettres ou chiffres.', next: 'gender',
        },
      },
      gender: {
        messages: [],
        choices: [
          { id: 'boy', text: 'un garçon', next: 'common', identity: { identityGender: 'boy', grammaticalGender: 'male', completed: true } },
          { id: 'girl', text: 'une fille', next: 'common', identity: { identityGender: 'girl', grammaticalGender: 'female', completed: true } },
          { id: 'neither', text: 'aucun des deux', next: 'pronoun', identity: { identityGender: 'neither' } },
        ],
      },
      pronoun: {
        messages: [{ speaker: 'contact', text: 'il ou elle ?', delayMs: 0, typingMs: 0 }],
        choices: [
          { id: 'he', text: 'il', next: 'common', identity: { identityGender: 'neither', grammaticalGender: 'male', completed: true } },
          { id: 'she', text: 'elle', next: 'common', identity: { identityGender: 'neither', grammaticalGender: 'female', completed: true } },
        ],
      },
      common: { messages: [{ speaker: 'contact', text: 'okiii :3', delayMs: 0, typingMs: 0 }], end: true },
    },
  };
}

test('nickname validation only accepts 3–16 ASCII letters or digits without trimming', () => {
  for (const accepted of ['Pixe', 'Alex2009', 'DarkKiller59', 'JustMe', 'A1b'])
    assert.equal(validatePlayerNickname(accepted), true, accepted);
  for (const rejected of [
    '', '  ', 'ab', 'a'.repeat(17), ' Jean', 'Jean Pierre', 'Élodie', 'Alex!',
    '<script>', 'line\nbreak', 'A\u0000bc', '💜abc', 'abc ',
  ]) {
    assert.equal(validatePlayerNickname(rejected), false, JSON.stringify(rejected));
    assert.equal(normalizePlayerNickname(rejected), '');
  }
  assert.equal(normalizePlayerNickname('a'.repeat(16)), 'a'.repeat(16));
});

test('Buddy collects grammatical agreement independently for all six gender and agreement combinations', () => {
  for (const identityGender of ['boy', 'girl', 'neither']) {
    for (const grammaticalGender of ['male', 'female']) {
      const patch = buddyIdentitySelection(identityGender, grammaticalGender);
      assert.deepEqual(patch, { identityGender, grammaticalGender, completed: true });
      const identity = normalizePlayerIdentity({ nickname: 'Player1', ...patch });
      assert.equal(identity.identityGender, identityGender);
      assert.equal(identity.grammaticalGender, grammaticalGender);
      assert.equal(resolvePlayerText('{player.grammaticalGender:il est prêt|elle est prête}', identity),
        grammaticalGender === 'male' ? 'il est prêt' : 'elle est prête');
    }
  }
});

test('dialogue text uses one stable player record for nickname and grammatical agreement', () => {
  const identity = {
    nickname: 'P1xe', identityGender: 'neither', grammaticalGender: 'female', completed: true,
  };
  assert.deepEqual(normalizePlayerIdentity(identity), identity);
  assert.equal(
    resolvePlayerText('{player.nickname} est {player.grammaticalGender:prêt|prête}', identity),
    'P1xe est prête',
  );
  assert.equal(
    resolvePlayerText('{player.gender:fort|forte}', { ...identity, grammaticalGender: 'male' }),
    'fort',
  );
  assert.equal(
    resolvePlayerText('{player.nickname}', { ...identity, nickname: '<script>' }),
    '<script>',
    'legacy display text is returned literally; new nickname submissions are separately rejected',
  );
});

test('generic free text waits, rejects invalid input without progressing, and saves a valid response once', () => {
  const storage = memoryStorage();
  const progression = new Progression(story, storage);
  const dialogue = inputDialogue();
  const session = new DialogueSession(dialogue, progression);
  session.deliver();
  assert.equal(session.input.id, 'nickname');
  const before = structuredClone(session.state.transcript);
  const handlers = {
    validators: { playerNickname: validatePlayerNickname },
    actions: {
      setPlayerNickname: (value, progress) => progress.updatePlayerIdentity({ nickname: value }),
    },
  };
  for (const invalid of ['', 'ab', '<script>', 'Jean Pierre', 'a'.repeat(17)])
    assert.equal(session.submitInput(invalid, handlers), false);
  assert.equal(session.state.node, 'ask');
  assert.deepEqual(session.state.transcript, before);
  assert.equal(progression.data.playerIdentity.nickname, 'Moi');

  assert.equal(session.submitInput('Pixe', handlers), true);
  assert.equal(session.state.node, 'gender');
  assert.deepEqual(session.state.transcript.map((item) => item.text), ['Ton pseudo ?', 'Pixe']);
  assert.equal(progression.data.playerIdentity.nickname, 'Pixe');
  const restored = new Progression(story, storage);
  const resumed = new DialogueSession(dialogue, restored);
  assert.equal(resumed.state.node, 'gender');
  assert.equal(resumed.state.transcript.filter((item) => item.text === 'Pixe').length, 1);
});

test('all three declared identity choices converge; only neither asks for grammatical preference', () => {
  for (const [choice, declared, grammatical] of [
    ['boy', 'boy', 'male'], ['girl', 'girl', 'female'], ['neither', 'neither', null],
  ]) {
    const progression = new Progression(story, memoryStorage());
    progression.updatePlayerIdentity({ nickname: 'Pixe' });
    const dialogue = inputDialogue();
    const session = new DialogueSession(dialogue, progression);
    session.state.node = 'gender';
    session.state.cursor = 0;
    session.persist();
    session.choose(choice);
    assert.equal(progression.data.playerIdentity.identityGender, declared);
    if (choice === 'neither') {
      assert.equal(progression.data.playerIdentity.completed, false);
      assert.equal(session.state.node, 'pronoun');
      session.deliver();
      session.choose('she');
      assert.equal(progression.data.playerIdentity.identityGender, 'neither');
      assert.equal(progression.data.playerIdentity.grammaticalGender, 'female');
      assert.equal(progression.data.playerIdentity.completed, true);
    } else {
      assert.equal(session.state.node, 'common');
      assert.equal(progression.data.playerIdentity.grammaticalGender, grammatical);
      assert.equal(progression.data.playerIdentity.completed, true);
    }
    assert.equal(session.state.node, 'common');
    session.deliver();
    assert.equal(session.state.transcript.at(-1).text, 'okiii :3');
  }
  for (const [pronoun, grammatical] of [['he', 'male'], ['she', 'female']]) {
    const progression = new Progression(story, memoryStorage());
    progression.updatePlayerIdentity({ nickname: 'Pixe' });
    const session = new DialogueSession(inputDialogue(), progression);
    session.state.node = 'gender';
    session.state.cursor = 0;
    session.persist();
    session.choose('neither');
    session.deliver();
    session.choose(pronoun);
    assert.equal(progression.data.playerIdentity.identityGender, 'neither');
    assert.equal(progression.data.playerIdentity.grammaticalGender, grammatical);
    assert.equal(session.state.node, 'common');
  }
});

test('authored PixelGirl paths preserve existing introduction choices and share one name/gender flow', () => {
  validateDialogue(intro);
  const introduction = intro.nodes.introduction;
  assert.ok(introduction.choices.some((choice) => choice.text === "t'avais plus de place pour mettre des X ?"));
  assert.deepEqual(introduction.choices.map((choice) => choice.next), ['artist', 'sweet', 'extra-xs']);
  for (const id of ['artist', 'sweet', 'extra-xs']) assert.equal(intro.nodes[id].next, 'table');
  for (const id of ['player-name', 'ask-gender', 'ask-pronoun', 'identity-convergence']) assert.equal(id in intro.nodes, false);
});

test('fresh identity starts as Moi; old progressed saves retain their JustMe name and masculine grammar', () => {
  const fresh = new Progression(story, memoryStorage());
  assert.deepEqual(fresh.data.playerIdentity, {
    nickname: 'Moi', identityGender: null, grammaticalGender: 'male', completed: false,
  });
  const legacyData = structuredClone(fresh.data);
  legacyData.started = true;
  delete legacyData.playerIdentity;
  const migrated = new Progression(story, memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacyData) }));
  assert.deepEqual(migrated.data.playerIdentity, LEGACY_PLAYER_IDENTITY);
  assert.deepEqual(
    normalizePlayerIdentity({ nickname: 'JustMe', gender: 'male' }),
    LEGACY_PLAYER_IDENTITY,
  );
});

test('New Game clears the nickname and declared and grammatical identity together', () => {
  const progression = new Progression(story, memoryStorage());
  progression.updatePlayerIdentity({ nickname: 'LunaFan' });
  progression.updatePlayerIdentity({ identityGender: 'girl', grammaticalGender: 'female', completed: true });
  progression.newGame();
  assert.deepEqual(progression.data.playerIdentity, {
    nickname: 'Moi', identityGender: null, grammaticalGender: 'male', completed: false,
  });
});

test('the human display name remains separate from BombArena technical player IDs', () => {
  const previous = structuredClone(playerIdentity);
  applyPlayerIdentity({ nickname: 'PixelFan', identityGender: 'girl', grammaticalGender: 'female', completed: true });
  const game = createGame({ playerNickname: playerIdentity.nickname, rng: () => 0.5 });
  assert.equal(game.players.find(({ id }) => id === 'justme').name, 'PixelFan');
  const chat = createBombArenaChat({ rng: () => 0, playerNickname: playerIdentity.nickname });
  chat.sendPlayerMessage('gg');
  assert.equal(chat.messages[0].authorId, 'justme');
  assert.equal(chat.messages[0].author, 'PixelFan');
  applyPlayerIdentity(previous);
});
