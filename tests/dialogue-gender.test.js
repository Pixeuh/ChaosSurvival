import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isValidPlayerText, resolvePlayerText } from '../src/story/player-identity.js';
import { DialogueSession, validateDialogue } from '../src/story/dialogue.js';
import { Progression } from '../src/story/progression.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { NarrativeOrchestrator, BOMB_ARENA_REMINDER_SEQUENCES, BOMB_ARENA_REMINDER_VARIANTS } from '../src/story/narrative-orchestrator.js';
import { popupContent } from '../src/config/popups.js';
import { createPopupContent } from '../src/ui/popup-content.js';
import { verifyPlayerTexts } from '../scripts/verify-player-text.mjs';

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const story = read('src/config/story.json');
const definitions = Object.fromEntries(readdirSync(new URL('../src/dialogues/', import.meta.url)).filter((f) => f.endsWith('.json')).map((file) => {
  const dialogue = read(`src/dialogues/${file}`); return [dialogue.id, dialogue];
}));
const memory = () => {
  const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const profiles = [
  { nickname: 'Alex2009', identityGender: 'boy', grammaticalGender: 'male', completed: true },
  { nickname: 'Pixe', identityGender: 'girl', grammaticalGender: 'female', completed: true },
  { nickname: 'PixelFan', identityGender: 'neither', grammaticalGender: 'male', completed: true },
  { nickname: 'PixelFan', identityGender: 'neither', grammaticalGender: 'female', completed: true },
];

test('authored variants reject missing/empty branches, wrong variables and raw objects before display', () => {
  for (const value of [null, undefined, { male: 'fort', female: 'forte' },
    '{player.gender:fort}', '{player.gender:fort|}', '{player.gender:|forte}',
    '{player.gender:fort|forte|x}', '{player.grammaticalGender:fort| }',
    '{player.nickname', '{player.nicknmae}', '{playerNickname}', '{player.gramaticalGender:fort|forte}',
  ]) {
    assert.equal(isValidPlayerText(value), false, JSON.stringify(value));
    assert.throws(() => resolvePlayerText(value, profiles[0]), /invalide/);
  }
  for (const value of ['tu joues trop bien', '{player.nickname}', '{player.gender:fort|forte}', '{player.grammaticalGender:fou|folle}'])
    assert.equal(isValidPlayerText(value), true);
  const invalid = structuredClone(definitions['pixelgirl-intro']);
  invalid.nodes['first-contact'].messages[0].text = '{player.gender:fort|}';
  assert.throws(() => validateDialogue(invalid), /Messages invalides/);
  invalid.nodes['first-contact'].messages[0].text = 'hello';
  invalid.nodes['first-contact'].choices[0].text = { male: 'oui' };
  assert.throws(() => validateDialogue(invalid), /Réponses invalides/);
});

test('grammar, declared identity, nickname and fixed JustMe references remain independent', () => {
  const template = "alors {player.nickname}, t'es {player.grammaticalGender:sûr d'être prêt|sûre d'être prête} ? JustMe est parti.";
  assert.equal(resolvePlayerText(template, profiles[0]), "alors Alex2009, t'es sûr d'être prêt ? JustMe est parti.");
  assert.equal(resolvePlayerText(template, profiles[1]), "alors Pixe, t'es sûre d'être prête ? JustMe est parti.");
  assert.equal(resolvePlayerText('{player.gender:il est devenu un vrai pro|elle est devenue une vraie pro}', profiles[3]), 'elle est devenue une vraie pro');
  assert.equal(resolvePlayerText("je suis trop contente !!! Luna est devenue folle", profiles[0]), "je suis trop contente !!! Luna est devenue folle");
  assert.equal(resolvePlayerText('bonjour {player.nickname}, {player.gender:prêt|prête} ?', null), 'bonjour Moi, prêt ?');
  assert.equal(resolvePlayerText('{player.gender:fort|forte}', { nickname: 'Girl', gender: 'male' }), 'fort');
});

test('every authored source and inline UI variant passes the static masculine/feminine checks', async () => {
  const sources = await verifyPlayerTexts();
  assert.equal(sources.filter(({ file }) => file.startsWith('src/dialogues/')).length, Object.keys(definitions).length);
  for (const definition of Object.values(definitions)) validateDialogue(definition);
});

test('real dialogue messages agree with the player while NPC self descriptions remain authored', () => {
  const cases = [
    ['pixelgirl-intro', 'refused', 0, "ptdrrr ok monsieur l'antivirus :')", "ptdrrr ok madame l'antivirus :')"],
    ['pixelgirl-smiley-victory', 's1-q1-a', 1, 'monsieur est un professionnel apparemment', 'madame est une professionnelle apparemment'],
    ['pixelgirl-smiley-victory', 's6-q1-c', 1, "donc t'es un VILAIN", "donc t'es une VILAINE"],
    ['turbo-smiley-catcher', 'hobbies-anything-reply', 0, 'ah ouais le mec il a pas de vie xD', 'ah ouais la meuf elle a pas de vie xD'],
    ['turbo-smiley-catcher', 'pc-parents-right-reply', 0, 'TRAITRE', 'TRAITRESSE'],
    ['turbo-super-plombier', 'record-reply', 0, 'ptdrrrr mauvais perdant', 'ptdrrrr mauvaise perdante'],
    ['turbo-super-plombier', 'record-reply', 1, 'fallait juste etre bon', 'fallait juste etre bonne'],
    ['turbo-super-plombier', 'bug-fraud-reply', 0, 'jaloux de mon talent', 'jalouse de mon talent'],
    ['pixelgirl-replay-love', 'hello', 0, "bon jvais finir par croire que t'es amoureux de ce jeu :')", "bon jvais finir par croire que t'es amoureuse de ce jeu :')"],
    ['pixelgirl-smiley-victory', 's7-common-1', 0, "jsuis contente que t'aies répondu tout à l'heure :3", "jsuis contente que t'aies répondu tout à l'heure :3"],
  ];
  for (const profile of profiles) for (const [id, node, cursor, male, female] of cases) {
    const storage = memory(); const progression = new Progression(story, storage);
    progression.updatePlayerIdentity(profile);
    const session = new DialogueSession(definitions[id], progression);
    Object.assign(session.state, { node, cursor }); session.persist();
    session.deliver(1000);
    const expected = profile.grammaticalGender === 'female' ? female : male;
    assert.equal(session.state.transcript.at(-1).text, expected, `${profile.identityGender}/${id}/${node}`);
    const restored = new Progression(story, storage);
    const resumed = new DialogueSession(definitions[id], restored);
    assert.equal(resumed.state.transcript.at(-1).text, expected);
    assert.deepEqual(restored.data.playerIdentity, profile);
  }
});

test('every grammatical choice keeps its ID, flags, next node and sent history across reload', () => {
  for (const definition of Object.values(definitions)) for (const [node, data] of Object.entries(definition.nodes))
    for (const choice of (data.choices ?? []).filter(({ text }) => text.includes('{player.'))) {
      const consequences = [];
      for (const profile of profiles) {
        const storage = memory(); const progression = new Progression(story, storage);
        progression.updatePlayerIdentity(profile);
        const session = new DialogueSession(definition, progression);
        Object.assign(session.state, { node, cursor: data.messages.length }); session.persist();
        const offered = session.choices.find(({ id }) => id === choice.id);
        assert.ok(offered);
        assert.doesNotMatch(offered.text, /\{player/);
        session.choose(choice.id);
        assert.equal(session.state.node, choice.next);
        assert.equal(session.state.transcript.at(-1).text, offered.text);
        const restored = new Progression(story, storage);
        const thread = new ConversationThread(definition.contact.id ?? definition.contact.name, restored, () => [definition]);
        const first = structuredClone(thread.sync()); thread.sync();
        assert.deepEqual(thread.state.history, first);
        assert.equal(first.at(-1).text, offered.text);
        assert.equal(restored.data.choices[0].choice, choice.id);
        assert.equal(restored.data.choices[0].text, offered.text);
        consequences.push({ node: session.state.node, flags: restored.data.flags, id: restored.data.choices[0].choice });
      }
      for (const value of consequences) assert.deepEqual(value, consequences[0]);
    }
});

test('group reminder factory and scheduled reception persist female pronouns without altering NPC text', () => {
  const profile = profiles[3], storage = memory(), progression = new Progression(story, storage);
  progression.updatePlayerIdentity(profile);
  const factory = Object.assign(Object.create(NarrativeOrchestrator.prototype), { definitions });
  const authored = [BOMB_ARENA_REMINDER_SEQUENCES[3][2], BOMB_ARENA_REMINDER_VARIANTS[2][3],
    BOMB_ARENA_REMINDER_VARIANTS[5][2]];
  const events = authored.map((line, i) => factory.bombArenaReminderDefinition(`grammar-reminder-${i}`, line));
  const thread = new ConversationThread('plumber-group', progression, () => events);
  for (let i = 0; i < events.length; i++) { thread.schedule(events[i], 1000 + i * 2000); thread.receive(1800 + i * 2000); }
  assert.deepEqual(thread.state.history.map(({ text }) => text), ['elle est partie se cacher mdr', 'elle est peut-être occupée', 'QUAND PixelFan REVIENT']);
  const restored = new Progression(story, storage);
  const next = new ConversationThread('plumber-group', restored, () => events);
  next.receive(20000); next.sync();
  assert.deepEqual(next.state.history, thread.state.history);
  assert.equal(restored.data.playerIdentity.identityGender, 'neither');
});

test('neither identity interrupted before pronoun selection stays incomplete after a reload', () => {
  const storage = memory(); const progression = new Progression(story, storage);
  progression.updatePlayerIdentity({ nickname: 'PixelFan' });
  const session = new DialogueSession(definitions['pixelgirl-intro'], progression);
  Object.assign(session.state, { node: 'ask-gender', cursor: 2 }); session.persist();
  session.choose('identity-neither');
  const restored = new Progression(story, storage);
  assert.equal(restored.data.playerIdentity.identityGender, 'neither');
  assert.equal(restored.data.playerIdentity.completed, false);
  const next = new DialogueSession(definitions['pixelgirl-intro'], restored);
  while (next.nextMessage()) next.deliver();
  assert.deepEqual(next.choices.map(({ id }) => id), ['pronoun-he', 'pronoun-she']);
  next.choose('pronoun-she');
  assert.deepEqual(restored.data.playerIdentity, profiles[3]);
});

test('arcade popups resolve player agreements before escaping HTML without changing NPC names', () => {
  const index = popupContent.msn.findIndex(({ name }) => name === '~ $t@r_girl ~');
  const feminine = createPopupContent('msn', () => (index + 0.5) / popupContent.msn.length, profiles[3]);
  assert.match(feminine.body, /connectée hein/);
  assert.match(feminine.body, /~ \$t@r_girl ~/);
  assert.doesNotMatch(feminine.body, /\{player|\[object Object\]/);
  assert.match(createPopupContent('ad', () => 0, profiles[1]).body, /LA 999 999ᵉ VISITEUSE/);
  assert.match(createPopupContent('ad', () => 0, profiles[0]).body, /LE 999 999ᵉ VISITEUR/);
});
