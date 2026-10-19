// Imported only inside Vite's development-only branch in main.js.
// Mini-game engines participate by exposing their normal, idempotent finish() method.
export function installDevelopmentVictoryShortcut(target, activeGame) {
  const onKey = (event) => {
    if (
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.repeat ||
      event.key.toLowerCase() !== 'd'
    )
      return;
    const game = activeGame();
    if (typeof game?.finish !== 'function') return;
    event.preventDefault();
    game.finish();
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
