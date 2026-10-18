const SYSTEM_SHORTCUTS = new Set(['computer', 'folder', 'bin']);
const SUPPORTED_ARCHIVES = new Set(['bomb-arena', 'smiley-pack-2009']);

export class WindowsXdContextMenus {
  constructor({ desktop, manager, desktopIcons, virtualFilesystem, desktopApplications, onFilesystemChange }) {
    Object.assign(this, {
      desktop,
      manager,
      desktopIcons,
      virtualFilesystem,
      desktopApplications,
      onFilesystemChange,
    });
    this.menu = document.createElement('div');
    this.menu.className = 'windows-xd-context-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.confirmation = document.createElement('section');
    this.confirmation.className = 'windows-xd-context-confirmation';
    this.confirmation.setAttribute('role', 'dialog');
    this.confirmation.setAttribute('aria-modal', 'true');
    this.confirmation.setAttribute('aria-label', 'Confirmer la suppression');
    this.confirmation.hidden = true;
    const question = document.createElement('p');
    const answers = document.createElement('div');
    for (const [answer, label] of [['yes', 'Oui'], ['no', 'Non']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xp-button';
      button.dataset.contextDeleteAnswer = answer;
      button.textContent = label;
      answers.append(button);
    }
    this.confirmation.append(question, answers);
    this.desktop.append(this.menu, this.confirmation);
    this.confirmation.querySelector('[data-context-delete-answer="no"]').addEventListener('click', () =>
      this.confirmation.hidden = true,
    );
    this.confirmation.querySelector('[data-context-delete-answer="yes"]').addEventListener('click', () =>
      this.confirmDelete(),
    );
    this.menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest?.('[data-context-action]')?.dataset.contextAction;
      const selected = this.actions.find((entry) => entry.id === action);
      if (!selected) return;
      this.closeMenu();
      selected.run();
    });
    this.onTaskbarContextMenu = (event) => {
      event.preventDefault();
      const tab = event.target.closest?.('button.task-tab[data-window-id]');
      if (!tab || !this.desktop.querySelector('.taskbar').contains(tab)) return this.closeMenu();
      event.stopPropagation();
      const id = Number(tab.dataset.windowId);
      if (!Number.isInteger(id) || !this.manager.windows.has(id)) return this.closeMenu();
      this.show([{ id: 'close-window', label: 'Fermer', run: () => this.manager.close(id) }], event, tab);
    };
    this.onDesktopContextMenu = (event) => {
      const iconArea = event.target.closest?.('.desktop-icons, .desktop-files');
      if (!iconArea || !this.desktop.contains(iconArea)) return;
      event.preventDefault();
      const button = event.target.closest?.('.desktop-icons button, .desktop-files button');
      if (!button || !this.desktop.contains(button)) return this.closeMenu();
      event.stopPropagation();
      const actions = this.desktopActions(button);
      if (actions.length) this.show(actions, event, button);
      else this.closeMenu();
    };
    this.onOutsideClick = (event) => {
      if (!this.menu.contains(event.target)) this.closeMenu();
      if (this.confirmation.hidden || this.confirmation.contains(event.target)) return;
      this.confirmation.hidden = true;
    };
    this.onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (!this.confirmation.hidden) this.confirmation.hidden = true;
      this.closeMenu(true);
    };
    this.desktop.querySelector('.taskbar').addEventListener('contextmenu', this.onTaskbarContextMenu);
    this.desktop.addEventListener('contextmenu', this.onDesktopContextMenu);
    document.addEventListener('click', this.onOutsideClick);
    document.addEventListener('keydown', this.onKeyDown);
  }
  desktopActions(button) {
    const shortcut = button.dataset.shortcut;
    if (shortcut) {
      if (SYSTEM_SHORTCUTS.has(shortcut)) return [];
      return [{ id: 'delete-shortcut', label: 'Supprimer', run: () => this.desktopIcons.remove(button) }];
    }
    if (button.classList.contains('desktop-virtual-shortcut'))
      return [{ id: 'delete-shortcut', label: 'Supprimer', run: () => this.desktopIcons.remove(button) }];
    const fileId = button.dataset.fileId;
    const file = this.virtualFilesystem?.getFile(fileId);
    if (!file) return [];
    const actions = [];
    if (SUPPORTED_ARCHIVES.has(file.extractable))
      actions.push({
        id: 'extract',
        label: 'Extraire avec WinRoar',
        run: () => this.desktopApplications.extractWithWinRoar(file),
      });
    if (this.virtualFilesystem.canDelete(fileId))
      actions.push({
        id: 'delete-file',
        label: 'Supprimer',
        run: () => this.askDeleteFile(file),
      });
    return actions;
  }
  show(actions, event, target) {
    this.closeMenu();
    this.actions = actions;
    this.target = target;
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.contextAction = action.id;
      button.setAttribute('role', 'menuitem');
      button.textContent = action.label;
      this.menu.append(button);
    }
    const bounds = this.desktop.getBoundingClientRect();
    this.menu.hidden = false;
    const left = Math.max(0, Math.min(event.clientX - bounds.left, this.desktop.clientWidth - this.menu.offsetWidth));
    const top = Math.max(0, Math.min(event.clientY - bounds.top, this.desktop.clientHeight - this.menu.offsetHeight));
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
    this.menu.querySelector('button')?.focus();
  }
  askDeleteFile(file) {
    this.pendingDelete = file.fileId;
    this.confirmation.querySelector('p').textContent = `Voulez-vous vraiment supprimer « ${file.name} » ?`;
    this.confirmation.hidden = false;
    this.confirmation.querySelector('[data-context-delete-answer="no"]').focus();
  }
  confirmDelete() {
    const fileId = this.pendingDelete;
    this.pendingDelete = null;
    this.confirmation.hidden = true;
    const result = this.virtualFilesystem.deleteFile(fileId);
    if (!result.ok) return;
    for (const removedId of result.removedFileIds ?? [fileId])
      this.desktopApplications.closeOpenFile(removedId);
    this.desktopApplications.refreshExplorers();
    this.onFilesystemChange(result);
  }
  closeMenu(restoreFocus = false) {
    this.menu.hidden = true;
    this.menu.replaceChildren();
    this.actions = [];
    const target = this.target;
    this.target = null;
    if (restoreFocus && target?.isConnected) target.focus?.();
  }
  dispose() {
    this.closeMenu();
    this.confirmation.hidden = true;
    this.desktop.querySelector('.taskbar').removeEventListener('contextmenu', this.onTaskbarContextMenu);
    this.desktop.removeEventListener('contextmenu', this.onDesktopContextMenu);
    document.removeEventListener('click', this.onOutsideClick);
    document.removeEventListener('keydown', this.onKeyDown);
    this.menu.remove();
    this.confirmation.remove();
  }
}
