import { bindFileActivation } from '../utils/activation.js';
import { icon } from './icons.js';
import { virtualFileId } from '../story/virtual-filesystem.js';

export class DesktopFiles {
  constructor(desktop, progression, onOpen, onLayout, virtualFilesystem = null, onDelete = () => {}) {
    Object.assign(this, { desktop, progression, onOpen, onLayout, virtualFilesystem, onDelete });
  }

  render() {
    let items = this.desktop.querySelector('#desktop-files');
    if (!items) {
      items = document.createElement('nav');
      items.id = 'desktop-files';
      items.className = 'desktop-files';
      items.setAttribute('aria-label', 'Raccourcis et fichiers du bureau');
      this.desktop.append(items);
    }
    if (!items.dataset.deleteBound) {
      items.dataset.deleteBound = 'true';
      items.addEventListener('keydown', (event) => {
        if (event.key !== 'Delete' || event.repeat || !this.virtualFilesystem) return;
        const button = event.target.closest?.('[data-file-id]');
        const fileId = button?.dataset.fileId;
        if (!fileId || !this.virtualFilesystem.canDelete(fileId)) return;
        event.preventDefault();
        const result = this.virtualFilesystem.deleteFile(fileId, { origin: 'desktop' });
        if (result.ok) {
          this.render();
          this.onDelete(result);
        }
      });
    }
    items.replaceChildren();
    const desktopItems = this.virtualFilesystem?.getLocation('user-desktop').items ?? [];
    for (const item of desktopItems) {
      const button = document.createElement('button');
      button.className = item.shortcut
        ? `desktop-file desktop-shortcut${item.shortcutId === 'bomb-arena' ? ' desktop-virtual-shortcut' : ''}`
        : 'desktop-file';
      button.dataset.fileId = item.fileId;
      if (item.targetFileId) button.dataset.targetFileId = item.targetFileId;
      if (item.shortcutId) button.dataset.shortcut = item.shortcutId;
      button.setAttribute('aria-pressed', 'false');
      button.title = item.shortcut ? `Raccourci vers ${item.label ?? item.targetFileId ?? item.name}` : item.name;
      button.innerHTML = icon(item.icon ?? 'document');
      const name = document.createElement('span');
      name.textContent = item.label ?? item.name;
      button.append(name);
      bindFileActivation(button, () => {
        if (this.virtualFilesystem?.exists(item.fileId)) this.onOpen(item);
      });
      items.append(button);
    }

    // Older callers without a VFS keep showing received desktop entries while
    // production always derives this surface from the shared Bureau location.
    if (!this.virtualFilesystem) {
      const received = new Map();
      for (const file of Object.values(this.progression.data.files ?? {})) {
        if (file.status !== 'complete' || file.direction !== 'receive') continue;
        const fileId = virtualFileId('downloads', file.name);
        if (!received.has(fileId)) received.set(fileId, file);
      }
      for (const file of received.values()) {
        const button = document.createElement('button');
        button.className = 'desktop-file';
        button.dataset.fileId = virtualFileId('downloads', file.name);
        button.setAttribute('aria-pressed', 'false');
        button.innerHTML = icon('download');
        const name = document.createElement('span');
        name.textContent = file.name;
        button.append(name);
        bindFileActivation(button, () => this.onOpen({ ...file, fileId: button.dataset.fileId }));
        items.append(button);
      }
    }
    this.onLayout();
  }
}
