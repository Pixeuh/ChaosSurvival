import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTypeForName, getDisplayFileName, setHideKnownExtensions } from '../src/ui/file-names.js';
import { fileIcon } from '../src/ui/icons.js';
import { mountDesktop } from '../src/ui/desktop.js';

test('known filename extensions are hidden case-insensitively without changing source names', () => {
  const cases = [
    ['SmileyCatcher.exe', 'SmileyCatcher'],
    ['BombArena.exe', 'BombArena'],
    ['ChaosSurvival.exe', 'ChaosSurvival'],
    ['SON_FINAL_8.mp3', 'SON_FINAL_8'],
    ['song.WAV', 'song'],
    ['vacances.png', 'vacances'],
    ['photo.JPG', 'photo'],
    ['photo.jpeg', 'photo'],
    ['animation.gif', 'animation'],
    ['scan.bmp', 'scan'],
    ['message.txt', 'message'],
    ['BombArena.zip', 'BombArena'],
    ['Raccourci.lnk', 'Raccourci'],
  ];
  for (const [name, expected] of cases) assert.equal(getDisplayFileName({ name }), expected, name);
  assert.equal(fileTypeForName('PHOTO.JpEg'), 'image');
  assert.equal(fileTypeForName('archive.xyz'), null);
  assert.equal(getDisplayFileName({ name: 'archive.xyz' }), 'archive.xyz');
  assert.equal(getDisplayFileName({ name: 'night.mp3.xyz' }), 'night.mp3.xyz');
  assert.equal(getDisplayFileName({ name: 'README', detail: 'Document' }), 'README');
});

test('showing known extensions is visual only and always keeps shortcut extensions hidden', () => {
  setHideKnownExtensions(false);
  try {
    assert.equal(getDisplayFileName({ name: 'BombArena.zip' }), 'BombArena.zip');
    assert.equal(getDisplayFileName({ name: 'BombArena.exe' }), 'BombArena.exe');
    assert.equal(getDisplayFileName({ name: 'archive.xyz' }), 'archive.xyz');
    assert.equal(getDisplayFileName({ name: 'ChaosSurvival.lnk' }), 'ChaosSurvival');
    assert.equal(getDisplayFileName({ name: 'Backup.zip', location: 'backup' }), 'Backup.zip');
  } finally {
    setHideKnownExtensions(true);
  }
});

test('file icons distinguish ZIP archives, applications and text documents', () => {
  assert.equal(fileIcon({ name: 'BombArena.zip', icon: 'document' }), 'archive');
  assert.equal(fileIcon({ name: 'BombArena.exe', fileId: 'bomb-arena-folder/bombarena.exe' }), 'arcade-game');
  assert.equal(fileIcon({ name: 'notes.txt', icon: 'document' }), 'document');
});

test('folders and shortcut labels use their own names; display formatting never mutates file data', () => {
  const folder = { name: 'Backup.zip', location: 'backup', detail: 'Dossier' };
  const shortcut = { name: 'ChaosSurvival.exe', targetFileId: 'my-games/another-target.exe', shortcut: true };
  const original = structuredClone(shortcut);
  assert.equal(getDisplayFileName(folder), 'Backup.zip');
  assert.equal(getDisplayFileName(shortcut), 'ChaosSurvival');
  assert.deepEqual(shortcut, original);

  const executable = { name: 'ChaosSurvival.exe', fileId: 'my-games/chaossurvival.exe' };
  assert.equal(getDisplayFileName(executable), 'ChaosSurvival');
  assert.equal(executable.name, 'ChaosSurvival.exe');
});

test('the initial desktop launcher also hides the known executable suffix', () => {
  const root = { innerHTML: '', querySelector: () => ({}), querySelectorAll: () => [] };
  mountDesktop(root, 0);
  assert.match(root.innerHTML, /<span>ChaosSurvival<\/span>/);
  assert.doesNotMatch(root.innerHTML, /<span>ChaosSurvival\.exe<\/span>/);
});
