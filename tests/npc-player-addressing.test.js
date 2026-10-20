import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dialogueDirectory = fileURLToPath(new URL('../src/dialogues/', import.meta.url));

function directlyAddressesPlayer(text) {
  return /^\s*(?:@)?justme(?:\s*[,!:]|\s*$)/i.test(text)
    || /\b(?:gg|bravo|félicitations?|merci|salut|coucou|hey|bonjour)\s+justme\b/i.test(text);
}

function collectNpcMessages(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const child of value) collectNpcMessages(child, result);
    return result;
  }
  if (value.speaker === 'contact' && typeof value.text === 'string') result.push(value.text);
  for (const child of Object.values(value)) collectNpcMessages(child, result);
  return result;
}

test('NPC dialogue does not address the player by the JustMe nickname', () => {
  const violations = [];
  for (const filename of readdirSync(dialogueDirectory).filter((name) => name.endsWith('.json'))) {
    const dialogue = JSON.parse(readFileSync(join(dialogueDirectory, filename), 'utf8'));
    for (const text of collectNpcMessages(dialogue)) {
      if (directlyAddressesPlayer(text)) violations.push(`${filename}: ${text}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('player nickname check detects vocatives without flagging player messages or incidental mentions', () => {
  assert.equal(directlyAddressesPlayer('GG JustMe'), true);
  assert.equal(directlyAddressesPlayer('JustMe, bravo !'), true);
  assert.equal(directlyAddressesPlayer('On a choisi JustMe comme pseudo'), false);

  const playerMessage = { speaker: 'player', text: 'GG JustMe' };
  assert.deepEqual(collectNpcMessages(playerMessage), []);
});
