import { createFreshProgressionData } from '../story/progression.js';

// Imported only inside Vite's development-only branch in main.js.
// A game may expose finishForDevelopment() when normal finish() requires real play.
// Otherwise finish() is the shared, idempotent completion contract.
export function installDevelopmentVictoryShortcut(target, activeGame) {
  const onKey = (event) => {
    if (
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.repeat ||
      event.target?.closest?.('input, textarea, select, [contenteditable="true"]') ||
      event.key.toLowerCase() !== 'd'
    )
      return;
    const game = activeGame();
    const finish = typeof game?.finishForDevelopment === 'function'
      ? game.finishForDevelopment.bind(game)
      : typeof game?.finish === 'function' ? game.finish.bind(game) : null;
    if (!finish) return;
    if (finish() === false) return;
    event.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

// Installed from the same import.meta.env.DEV-only entry point as the arcade shortcut.
export function installDevelopmentConversationShortcut(
  target,
  activeConversation,
  onFinished = () => {},
  key = 'f',
) {
  const onKey = (event) => {
    if (
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.repeat ||
      event.key.toLowerCase() !== key ||
      event.target?.closest?.('input, textarea, select, [contenteditable="true"]')
    )
      return;
    const conversation = activeConversation();
    if (typeof conversation?.finishImmediately !== 'function') return;
    event.preventDefault();
    conversation.finishImmediately();
    onFinished(conversation);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

export function installDevelopmentBombArenaShortcut(target, onOpen) {
  const onKey = (event) => {
    if (
      !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat ||
      event.key.toLowerCase() !== 'b' ||
      event.target?.closest?.('input, textarea, select, [contenteditable="true"]')
    ) return;
    event.preventDefault();
    onOpen();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

class DevelopmentMemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
  key(index) { return [...this.values.keys()][index] ?? null; }
}

export function createDevelopmentProgressionSandbox(progression) {
  let saved = null;
  return {
    get active() { return Boolean(saved); },
    enter(dialogue) {
      const nodeId = 'bomb-arena-intro';
      if (!progression?.story || !dialogue?.nodes?.[nodeId]) return false;
      if (!saved) saved = {
        data: progression.data,
        storage: progression.storage,
        corrupt: progression.corrupt,
        persistenceError: progression.persistenceError,
      };
      progression.storage = new DevelopmentMemoryStorage();
      progression.data = createFreshProgressionData(progression.story);
      progression.data.current = null;
      progression.data.started = true;
      progression.data.flags.superPlombierGroupCreated = true;
      // Ctrl+Shift+B skips the private post-game beats but must enter the same
      // orchestrator branch that owns group delivery and the BombArena offer.
      progression.data.flags.superPlombierPostStarted = true;
      progression.data.flags.superPlombierGroupCreatedAt = Date.now();
      progression.data.flags.superPlombierGroupNotified = true;
      progression.data.unlockedConversations = [dialogue.id];
      progression.data.dialogues[dialogue.id] = {
        node: nodeId,
        cursor: 0,
        transcript: [],
        finished: false,
        revision: dialogue.revision ?? 1,
      };
      progression.corrupt = false;
      progression.persistenceError = false;
      return progression.save();
    },
    restore() {
      if (!saved) return false;
      progression.data = saved.data;
      progression.storage = saved.storage;
      progression.corrupt = saved.corrupt;
      progression.persistenceError = saved.persistenceError;
      saved = null;
      return true;
    },
  };
}

export function prepareBombArenaForDevelopment(progression, virtualFilesystem, dialogue) {
  if (!progression?.data?.dialogues?.[dialogue?.id]?.finished || !virtualFilesystem) return false;
  const transfer = Object.entries(dialogue.nodes ?? {}).flatMap(([nodeId, node]) =>
    (node.messages ?? [])
      .filter((message) => message.type === 'file' && message.file?.extractable === 'bomb-arena')
      .map((message) => ({ nodeId, file: message.file })),
  )[0];
  if (!transfer) return false;

  const archiveId = `downloads/${transfer.file.name}`.toLowerCase();
  let archive = virtualFilesystem.getFile(archiveId);
  if (!archive) {
    const previousTransfers = Object.values(progression.data.files).filter(
      (file) =>
        file.dialogue === dialogue.id &&
        file.node === transfer.nodeId &&
        file.direction === 'receive' &&
        file.id === transfer.file.id &&
        file.extractable === 'bomb-arena',
    );
    const latest = previousTransfers.at(-1);
    const latestKey = latest?.key;
    const deletedKey = latestKey &&
      `received:${archiveId}:${encodeURIComponent(latestKey)}`;
    const alreadyDeleted = Boolean(
      latestKey &&
      (virtualFilesystem.state.deleted.includes(archiveId) ||
        virtualFilesystem.state.deleted.includes(deletedKey)),
    );
    const offer = previousTransfers.reduce((max, file) => {
      const value = Number(file.key?.match(/:(\d+)$/)?.[1]);
      return Number.isInteger(value) ? Math.max(max, value) : max;
    }, -1) + 1;
    const received = latest && !alreadyDeleted
      ? latest
      : progression.receiveFile(transfer.file, dialogue.id, transfer.nodeId, 'receive', offer);
    progression.finishTransfer(received.key);
    archive = virtualFilesystem.getFile(archiveId);
  } else if (archive.status !== 'complete' && archive.receivedFile) {
    const received = progression.data.files[archive.transferKey];
    if (!received) return false;
    progression.finishTransfer(received.key);
    archive = virtualFilesystem.getFile(archiveId);
  }
  if (archive?.extractable !== 'bomb-arena') return false;
  const extracted = virtualFilesystem.extractBombArena(archiveId);
  return extracted.ok && virtualFilesystem.exists('bomb-arena-folder/bombarena.exe');
}
