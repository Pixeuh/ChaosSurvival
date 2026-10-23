import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { validateStory } from '../src/story/progression.js';
import { validateDialogue } from '../src/story/dialogue.js';
import { validateGameRules } from '../src/ui/game-rules.js';
import { verifyPlayerTexts } from './verify-player-text.mjs';

const root = new URL('../', import.meta.url);
const story = JSON.parse(await readFile(new URL('src/config/story.json', root), 'utf8'));
validateStory(story);
await verifyPlayerTexts();
const ids = new Set();
const contacts = JSON.parse(await readFile(new URL('src/config/contacts.json', root), 'utf8'));
for (const contact of contacts) {
  assert.match(contact.avatar ?? './avatars/player.svg', /^\.\/avatars\/[a-z0-9-]+\.svg$/i);
  if (contact.avatar) await access(new URL(`public/${contact.avatar.slice(2)}`, root));
}
const games = new Map();
const chart = JSON.parse(await readFile(new URL('src/config/chart.json', root), 'utf8'));
validateGameRules(chart);
const ruleIds = new Set([chart.rules.id]);
for (const filename of await readdir(new URL('src/minigames/', root))) {
  if (!filename.endsWith('.json')) continue;
  const game = JSON.parse(await readFile(new URL(`src/minigames/${filename}`, root), 'utf8'));
  validateGameRules(game);
  if (game.rules) {
    assert.ok(!ruleIds.has(game.rules.id), `Règles dupliquées : ${game.rules.id}`);
    ruleIds.add(game.rules.id);
  }
  assert.ok(!games.has(game.id));
  assert.ok(
    game.durationSeconds > 0 &&
      game.durationSeconds <= 300 &&
      game.spawnSeconds > 0 &&
      game.targetLifetimeSeconds > 0 &&
      game.maxTargets >= 1,
  );
  games.set(game.id, game);
}
for (const filename of await readdir(new URL('src/dialogues/', root))) {
  if (!filename.endsWith('.json')) continue;
  const dialogue = JSON.parse(await readFile(new URL(`src/dialogues/${filename}`, root), 'utf8'));
  validateDialogue(dialogue);
  if (dialogue.completion?.connection)
    assert.ok(
      contacts.some(
        (contact) => contact.id === dialogue.completion.connection.contactId && contact.connection,
      ),
      'Contact de connexion absent',
    );
  assert.ok(!ids.has(dialogue.id), `Dialogue dupliqué : ${dialogue.id}`);
  ids.add(dialogue.id);
  for (const node of Object.values(dialogue.nodes))
    for (const message of node.messages) {
      if (message.file?.launch) {
        assert.ok(
          games.has(message.file.launch.game),
          `Mini-jeu absent : ${message.file.launch.game}`,
        );
        const sequence = story.sequences.find((item) => item.id === message.file.launch.sequence);
        assert.ok(
          sequence?.type === 'minigame' && sequence.game === message.file.launch.game,
          'Séquence de fichier incohérente',
        );
      }
    }
  for (const person of [dialogue.contact, dialogue.player]) {
    assert.match(person.avatar, /^\.\/avatars\/[a-z0-9-]+\.svg$/i);
    await access(new URL(`public/${person.avatar.slice(2)}`, root));
  }
}
for (const sequence of story.sequences)
  if (sequence.type === 'conversation')
    assert.ok(ids.has(sequence.dialogue), `Conversation absente : ${sequence.dialogue}`);
for (const sequence of story.sequences)
  if (sequence.type === 'minigame') assert.ok(games.has(sequence.game));
console.log(
  `Histoire vérifiée : ${story.sequences.length} séquences, ${ids.size} dialogue(s), avatars locaux intégrés.`,
);
