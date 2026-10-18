import { bindFileActivation } from '../utils/activation.js';
import { icon } from './icons.js';
import { virtualFileId } from '../story/virtual-filesystem.js';

export class DesktopFiles {
  constructor(desktop, progression, onOpen, onLayout, virtualFilesystem = null) {
    Object.assign(this, { desktop, progression, onOpen, onLayout, virtualFilesystem });
  }
  render() {
    let files = this.desktop.querySelector('#desktop-files');
    if (!files) {
      files = document.createElement('nav');
      files.id = 'desktop-files';
      files.className = 'desktop-files';
      files.setAttribute('aria-label', 'Fichiers reçus');
      this.desktop.append(files);
    }
    files.replaceChildren();
    const received = new Map();
    for (const file of Object.values(this.progression.data.files)) {
      if (file.status !== 'complete' || file.direction !== 'receive') continue;
      const fileId = virtualFileId('downloads', file.name);
      if (this.virtualFilesystem && !this.virtualFilesystem.exists(fileId)) continue;
      if (!received.has(fileId)) received.set(fileId, file);
    }
    for (const file of received.values()) {
      const button = document.createElement('button');
      button.className = 'desktop-file';
      button.dataset.fileId = this.virtualFilesystem
        ? virtualFileId('downloads', file.name)
        : file.id;
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = icon('download');
      const name = document.createElement('span');
      name.textContent = file.name;
      button.append(name);
      bindFileActivation(button, () => {
        if (
          !this.virtualFilesystem ||
          this.virtualFilesystem.exists(virtualFileId('downloads', file.name))
        ) this.onOpen(file);
      });
      files.append(button);
    }
    const bombArenaId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
    const executable = this.virtualFilesystem?.getFile(bombArenaId);
    const bombArenaShortcutId = `file:${bombArenaId}`;
    const removedShortcuts = this.progression.data.desktopIconsRemoved ?? [];
    if (executable?.virtualApp === 'bomb-arena' && !removedShortcuts.includes(bombArenaShortcutId)) {
      const shortcut = document.createElement('button');
      shortcut.className = 'desktop-file desktop-virtual-shortcut';
      shortcut.dataset.fileId = bombArenaId;
      shortcut.setAttribute('aria-pressed', 'false');
      shortcut.title = 'Raccourci vers BombArena.exe';
      shortcut.innerHTML = icon('arcade-game');
      const name = document.createElement('span');
      name.textContent = executable.name;
      shortcut.append(name);
      bindFileActivation(shortcut, () => {
        if (this.virtualFilesystem?.exists(bombArenaId))
          this.onOpen({ ...executable, name: 'BombArena.exe', fileId: bombArenaId, virtualApp: 'bomb-arena' });
      });
      files.append(shortcut);
    }
    this.onLayout();
  }
}
