import test from 'node:test';
import assert from 'node:assert/strict';
import { quitFromStartMenu, returnFromStartMenu } from '../src/ui/start-menu-actions.js';

test('Start menu return closes the menu and uses the existing return transition', () => {
  const calls = [];
  const returned = returnFromStartMenu({
    closeMenu: () => calls.push('close'),
    returnToMenu: () => {
      calls.push('return');
      return true;
    },
    onSaveFailure: () => calls.push('save-error'),
  });
  assert.equal(returned, true);
  assert.deepEqual(calls, ['close', 'return']);
});

test('failed return save keeps the game transition from running and reports the error', () => {
  const calls = [];
  assert.equal(
    returnFromStartMenu({
      closeMenu: () => calls.push('close'),
      returnToMenu: () => false,
      onSaveFailure: () => calls.push('save-error'),
    }),
    false,
  );
  assert.deepEqual(calls, ['close', 'save-error']);
});

test('quit persists before invoking the Electron quit bridge', async () => {
  const calls = [];
  assert.equal(
    await quitFromStartMenu({
      closeMenu: () => calls.push('close'),
      hasSave: true,
      save: () => (calls.push('save'), true),
      quitApp: () => calls.push('quit'),
      closeWindow: () => calls.push('browser-close'),
      onSaveFailure: () => calls.push('save-error'),
      onQuitFailure: () => calls.push('quit-error'),
    }),
    true,
  );
  assert.deepEqual(calls, ['close', 'save', 'quit']);
});

test('quit leaves the app open when saving fails', async () => {
  const calls = [];
  assert.equal(
    await quitFromStartMenu({
      closeMenu: () => calls.push('close'),
      hasSave: true,
      save: () => (calls.push('save'), false),
      quitApp: () => calls.push('quit'),
      closeWindow: () => calls.push('browser-close'),
      onSaveFailure: () => calls.push('save-error'),
      onQuitFailure: () => calls.push('quit-error'),
    }),
    false,
  );
  assert.deepEqual(calls, ['close', 'save', 'save-error']);
});

test('browser quit requests normal window close without requiring it to be permitted', async () => {
  const calls = [];
  assert.equal(
    await quitFromStartMenu({
      closeMenu: () => calls.push('close'),
      hasSave: false,
      save: () => calls.push('save'),
      closeWindow: () => calls.push('browser-close'),
      onSaveFailure: () => calls.push('save-error'),
      onQuitFailure: () => calls.push('quit-error'),
    }),
    true,
  );
  assert.deepEqual(calls, ['close', 'browser-close']);
});
