import { arcadeLauncher } from './arcade-launcher.js';

// This is the sole declaration for installed application shortcuts. The
// virtual filesystem uses the same entries to expose the Bureau folder.
export const DESKTOP_SHORTCUTS = Object.freeze([
  Object.freeze({ id: 'msn', name: 'Windows Love Messenger.lnk', label: 'Windows Love Messenger', icon: 'msn', target: 'messenger-files/love-messenger.exe', action: 'messenger' }),
  Object.freeze({ id: 'browser', name: 'Internet Adventurer.lnk', label: 'Internet Adventurer', icon: 'browser', target: 'browser-files/adventurer.exe', action: 'browser' }),
  Object.freeze({ id: 'media-player', name: 'Windows Media Play.lnk', label: 'Windows Media Play', icon: 'media-play', target: 'media-files/media-play.exe', action: 'media-player' }),
  Object.freeze({ id: arcadeLauncher.shortcutId, name: arcadeLauncher.name, label: arcadeLauncher.name, icon: arcadeLauncher.icon, action: 'level-one' }),
  Object.freeze({ id: 'bomb-arena', name: 'BombArena.exe.lnk', label: 'BombArena.exe', icon: 'arcade-game', target: 'bomb-arena-folder/bombarena.exe', action: 'bomb-arena' }),
]);
// Shortcut targets and their launch actions are declared together above.
// Remaining associations are for programs that do not have desktop shortcuts.
export const VIRTUAL_EXECUTABLES = Object.freeze({
  ...Object.fromEntries(DESKTOP_SHORTCUTS.filter((item) => item.target && item.action)
    .map((item) => [item.target, item.action])),
  'downloads/toolbar_setup.exe': 'toolbar-installer',
  'downloads/super_mega_game.exe': 'received-minigame',
});
// Only virtual filesystem IDs can launch files. This registry never accepts
// host paths or delegates execution to the operating system.
export class ExecutableRegistry {
  constructor(virtualFilesystem, handlers = {}) {
    this.virtualFilesystem = virtualFilesystem;
    this.handlers = handlers;
  }

  resolve(fileId) {
    const canonicalId = typeof fileId === 'string' ? fileId.toLowerCase() : '';
    const file = this.virtualFilesystem?.getFile(canonicalId);
    if (!file || file.directory === true) return { status: 'missing' };
    if (!/\.exe$/i.test(file.name)) return { status: 'not-executable', file, fileId: canonicalId };

    const action = VIRTUAL_EXECUTABLES[canonicalId];
    if (!action)
      return {
        status: 'unrecognized',
        file,
        fileId: canonicalId,
        message: 'Impossible d’ouvrir cette application.',
      };
    return { status: 'associated', file, fileId: canonicalId, action };
  }

  launch(fileId, { source = 'explorer' } = {}) {
    const resolved = this.resolve(fileId);
    if (resolved.status !== 'associated') return resolved;

    const { action, file, fileId: canonicalId } = resolved;
    const handler = this.handlers[action];
    if (!handler)
      return {
        status: 'unimplemented',
        file,
        fileId: canonicalId,
        action,
        message:
          action === 'toolbar-installer' && typeof file.text === 'string'
            ? file.text
            : 'Cette application virtuelle n’est pas encore disponible.',
      };
    return { status: 'launched', file, fileId: canonicalId, value: handler(file, canonicalId, { source }) };
  }

  launchShortcut(shortcutId, file = null, { source = 'desktop' } = {}) {
    const shortcut = DESKTOP_SHORTCUTS.find((item) => item.id === shortcutId);
    if (shortcut?.target) return this.launch(shortcut.target, { source });
    const action = shortcut?.action;
    const handler = action && this.handlers[action];
    return handler ? handler(file, `desktop-shortcut/${shortcutId}`, { source }) : null;
  }
}
