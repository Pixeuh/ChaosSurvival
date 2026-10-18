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
    const removedShortcuts = this.progression.data.desktopIconsRemoved ?? [];
    const renderedShortcutTargets = new Set();
    for (const file of received.values()) {
      const fileId = virtualFileId('downloads', file.name);
      const smileyCatcherShortcut = file.launch?.game === 'smiley-catcher';
      if (
        smileyCatcherShortcut &&
        removedShortcuts.includes(`file:${fileId}`)
      ) continue;
      const button = document.createElement('button');
      button.className = smileyCatcherShortcut
        ? 'desktop-file desktop-virtual-shortcut'
        : 'desktop-file';
      button.dataset.fileId = this.virtualFilesystem
        ? fileId
        : file.id;
      if (smileyCatcherShortcut) renderedShortcutTargets.add(button.dataset.fileId);
      if (smileyCatcherShortcut) button.title = `Raccourci vers ${file.name}`;
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
      renderedShortcutTargets.add(bombArenaId);
    }
    for (const record of this.progression.data.desktopShortcuts ?? []) {
      const shortcutId = `shortcut:${record.id}`;
      if (removedShortcuts.includes(shortcutId) || renderedShortcutTargets.has(record.targetFileId)) continue;
      const target = this.virtualFilesystem?.getFile(record.targetFileId);
      const button = document.createElement('button');
      button.className = 'desktop-file desktop-virtual-shortcut';
      button.dataset.fileId = record.targetFileId;
      button.dataset.shortcutId = record.id;
      button.title = `Raccourci vers ${target?.name ?? record.name}`;
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = icon(target?.icon ?? record.icon);
      const name = document.createElement('span');
      name.textContent = target?.name ?? record.name;
      button.append(name);
      bindFileActivation(button, () => {
        const current = this.virtualFilesystem?.getFile(record.targetFileId);
        const item = current
          ? { ...current, fileId: record.targetFileId, shortcutTarget: true }
          : { fileId: record.targetFileId, name: record.name, shortcutTarget: true };
        this.onOpen(item, current ? this.virtualFilesystem.getLocation(current.locationId) : null);
      });
      files.append(button);
      renderedShortcutTargets.add(record.targetFileId);
    }
    this.onLayout();
  }
}
