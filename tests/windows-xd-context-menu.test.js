import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsXdContextMenus } from '../src/ui/windows-xd-context-menu.js';

class Element {
  constructor(tagName = 'DIV') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.style = {};
    this.handlers = {};
    this.hidden = false;
    this.isConnected = true;
    this.offsetWidth = 150;
    this.offsetHeight = 90;
    this.className = '';
    this.classList = { contains: (name) => this.className.split(' ').includes(name) };
  }
  append(...children) {
    for (const child of children) child.parent = this;
    this.children.push(...children);
  }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.handlers[type] = listener; }
  removeEventListener(type) { delete this.handlers[type]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  contains(target) { return this === target || this.children.some((child) => child.contains?.(target)); }
  closest(selector) {
    if (selector === '.desktop-icons, .desktop-files')
      return this.parent && (this.parent.classList.contains('desktop-icons') || this.parent.classList.contains('desktop-files')) ? this.parent : null;
    if (selector === 'button.task-tab[data-window-id]')
      return this.tagName === 'BUTTON' && this.classList.contains('task-tab') && this.dataset.windowId ? this : null;
    if (selector === '.desktop-icons button, .desktop-files button')
      return this.tagName === 'BUTTON' && (this.parent?.classList.contains('desktop-icons') || this.parent?.classList.contains('desktop-files')) ? this : null;
    if (selector === '[data-context-action]') return this.dataset.contextAction ? this : null;
    return null;
  }
  querySelector(selector) {
    const matches = (item) => {
      if (selector === '.taskbar' && item.classList.contains('taskbar')) return true;
      if (selector === 'button' && item.tagName === 'BUTTON') return true;
      const answer = selector.match(/^\[data-context-delete-answer="(yes|no)"\]$/)?.[1];
      if (answer && item.dataset.contextDeleteAnswer === answer) return true;
      if (selector === 'p' && item.tagName === 'P') return true;
      return false;
    };
    const visit = (item) => {
      for (const child of item.children) {
        if (matches(child)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  focus() { this.focused = true; }
  remove() { this.isConnected = false; }
}

function setup(t) {
  const previous = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  t.after(() => { globalThis.document = previous; });
  const desktop = new Element();
  desktop.clientWidth = 800;
  desktop.clientHeight = 600;
  const taskbar = new Element();
  taskbar.className = 'taskbar';
  const originalQuerySelector = desktop.querySelector.bind(desktop);
  desktop.querySelector = (selector) => selector === '.taskbar' ? taskbar : originalQuerySelector(selector);
  desktop.append = (...children) => {
    for (const child of children) child.parent = desktop;
    desktop.children.push(...children);
  };
  const manager = { windows: new Map([[17, {}], [23, {}]]), closed: [], close(id) { this.closed.push(id); } };
  const calls = { removed: [], removedMany: [], extracted: [], filesystem: [] };
  const desktopIcons = {
    selection: [],
    remove(button) { calls.removed.push(button); },
    removeMany(buttons) { calls.removedMany.push([...buttons]); },
    contextSelection(button) {
      if (!this.selection.includes(button)) this.selection = [button];
      return this.selection;
    },
    buttons() { return [...this.selection]; },
    deselectMany(buttons) { this.selection = this.selection.filter((item) => !buttons.includes(item)); },
  };
  const virtualFilesystem = {
    getFile(id) { return id ? { name: id.endsWith('.zip') ? 'BombArena.zip' : 'notes.txt', fileId: id, extractable: id.endsWith('.zip') ? 'bomb-arena' : undefined } : null; },
    canDelete(id) { return Boolean(id); },
    deleteFile(id) { calls.deleted = id; return { ok: true, removedFileIds: [id] }; },
  };
  const desktopApplications = {
    extractWithWinRoar(file) { calls.extracted.push(file.fileId); },
    closeOpenFile(id) { calls.closedFile = id; },
    refreshExplorers() { calls.refresh = true; },
  };
  const menus = new WindowsXdContextMenus({ desktop, manager, desktopIcons, virtualFilesystem, desktopApplications, onFilesystemChange: (result) => calls.filesystem.push(result) });
  return { desktop, taskbar, manager, calls, menus, listeners, desktopIcons };
}

test('taskbar context menu closes only the clicked window, including minimized tabs, without restoring it', (t) => {
  const { desktop, taskbar, manager, menus } = setup(t);
  let blankDefaultPrevented = false;
  taskbar.handlers.contextmenu({
    target: new Element(),
    preventDefault() { blankDefaultPrevented = true; },
    stopPropagation() {},
  });
  assert.equal(blankDefaultPrevented, true, 'the shell suppresses the browser native context menu');
  assert.equal(menus.menu.hidden, true, 'an empty taskbar area does not open a menu');
  const tab = new Element('button');
  tab.className = 'task-tab';
  tab.dataset.windowId = '23';
  taskbar.append(tab);
  let defaultPrevented = false;
  taskbar.handlers.contextmenu({ target: tab, clientX: 790, clientY: 590, preventDefault() { defaultPrevented = true; }, stopPropagation() {} });
  assert.equal(defaultPrevented, true);
  assert.equal(menus.menu.hidden, false);
  assert.equal(menus.menu.children[0].textContent, 'Fermer');
  assert.equal(menus.menu.style.left, '650px');
  assert.equal(menus.menu.style.top, '510px');
  menus.menu.handlers.click({ target: menus.menu.children[0], stopPropagation() {} });
  assert.deepEqual(manager.closed, [23]);
  assert.equal(tab.hidden, false, 'the task button was not activated to restore the window');
  assert.equal(desktop.children.includes(menus.menu), true);
  menus.dispose();
});

test('desktop context actions distinguish system icons, shortcuts, ZIP files and other virtual files', (t) => {
  const { desktop, menus, calls } = setup(t);
  const systemIcons = new Element();
  systemIcons.className = 'desktop-icons';
  const computer = new Element('button');
  computer.dataset.shortcut = 'computer';
  systemIcons.append(computer);
  desktop.append(systemIcons);
  let prevented = false;
  desktop.handlers.contextmenu({ target: computer, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(menus.menu.hidden, true, 'system shortcuts have no removal action');

  const appShortcut = new Element('button');
  appShortcut.dataset.shortcut = 'windows-media-play';
  systemIcons.append(appShortcut);
  desktop.handlers.contextmenu({ target: appShortcut, clientX: 40, clientY: 50, preventDefault() {}, stopPropagation() {} });
  assert.equal(menus.menu.children[0].textContent, 'Supprimer');
  menus.menu.handlers.click({ target: menus.menu.children[0], stopPropagation() {} });
  assert.deepEqual(calls.removed, [appShortcut]);

  const files = new Element();
  files.className = 'desktop-files';
  const zip = new Element('button');
  zip.dataset.fileId = 'downloads/bombarena.zip';
  files.append(zip);
  desktop.append(files);
  assert.equal(desktop.contains(zip), true);
  assert.equal(zip.closest('.desktop-icons button, .desktop-files button'), zip);
  desktop.handlers.contextmenu({ target: zip, clientX: 30, clientY: 30, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(menus.menu.children.map((button) => button.textContent), ['Extraire avec WinRoar', 'Supprimer']);
  assert.deepEqual(calls.extracted, [], 'right-click alone does not run extraction');
  menus.menu.handlers.click({ target: menus.menu.children[0], stopPropagation() {} });
  assert.deepEqual(calls.extracted, ['downloads/bombarena.zip']);

  desktop.handlers.contextmenu({ target: zip, clientX: 30, clientY: 30, preventDefault() {}, stopPropagation() {} });
  menus.menu.handlers.click({ target: menus.menu.children[1], stopPropagation() {} });
  assert.equal(menus.confirmation.hidden, false);
  menus.confirmation.querySelector('[data-context-delete-answer="yes"]').handlers.click();
  assert.equal(calls.deleted, 'downloads/bombarena.zip');
  assert.equal(calls.closedFile, 'downloads/bombarena.zip');
  assert.equal(calls.refresh, true);
  assert.equal(calls.filesystem.length, 1);
  menus.dispose();
});

test('right-clicking selected SmileyCatcher and Media Play shortcuts removes both shortcuts together', (t) => {
  const { desktop, menus, calls, desktopIcons } = setup(t);
  const icons = new Element();
  icons.className = 'desktop-icons';
  const media = new Element('button');
  media.dataset.shortcut = 'windows-media-play';
  const files = new Element();
  files.className = 'desktop-files';
  const smiley = new Element('button');
  smiley.className = 'desktop-file desktop-virtual-shortcut';
  smiley.dataset.fileId = 'downloads/super_mega_game.exe';
  files.append(smiley);
  icons.append(media);
  desktop.append(icons, files);
  desktopIcons.selection = [smiley, media];

  desktop.handlers.contextmenu({ target: smiley, clientX: 50, clientY: 60, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(desktopIcons.selection, [smiley, media], 'the selected group stays intact');
  assert.deepEqual(menus.menu.children.map((item) => item.textContent), ['Supprimer']);
  menus.menu.handlers.click({ target: menus.menu.children[0], stopPropagation() {} });
  assert.deepEqual(calls.removedMany, [[smiley, media]]);
  assert.equal(calls.deleted, undefined, 'the original SmileyCatcher executable is not deleted');
  assert.deepEqual(calls.removed, [], 'the clicked icon is not deleted separately');
  menus.dispose();
});

test('right-clicking outside the selection replaces it; mixed delete preserves system shortcuts', (t) => {
  const { desktop, menus, calls, desktopIcons } = setup(t);
  const icons = new Element();
  icons.className = 'desktop-icons';
  const oldSelection = new Element('button');
  oldSelection.dataset.shortcut = 'msn';
  const media = new Element('button');
  media.dataset.shortcut = 'windows-media-play';
  const computer = new Element('button');
  computer.dataset.shortcut = 'computer';
  icons.append(oldSelection, media, computer);
  const files = new Element();
  files.className = 'desktop-files';
  const zip = new Element('button');
  zip.dataset.fileId = 'downloads/bombarena.zip';
  files.append(zip);
  desktop.append(icons, files);
  desktopIcons.selection = [oldSelection, computer];

  desktop.handlers.contextmenu({ target: media, clientX: 40, clientY: 50, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(desktopIcons.selection, [media], 'an unselected target becomes the only selection');
  menus.closeMenu();

  desktopIcons.selection = [media, zip, computer];
  desktop.handlers.contextmenu({ target: media, clientX: 40, clientY: 50, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(menus.menu.children.map((item) => item.textContent), ['Supprimer']);
  menus.menu.handlers.click({ target: menus.menu.children[0], stopPropagation() {} });
  assert.equal(menus.confirmation.hidden, false, 'mixed file deletion asks once for the whole selection');
  menus.confirmation.querySelector('[data-context-delete-answer="yes"]').handlers.click();
  assert.deepEqual(calls.removedMany, [[media]]);
  assert.equal(calls.deleted, 'downloads/bombarena.zip');
  assert.equal(desktopIcons.selection.includes(computer), true, 'the protected system icon remains selected');
  menus.dispose();
});

test('context menus close on outside click and Escape', (t) => {
  const { desktop, menus, listeners } = setup(t);
  const group = new Element();
  group.className = 'desktop-icons';
  const appShortcut = new Element('button');
  appShortcut.dataset.shortcut = 'browser';
  group.append(appShortcut);
  desktop.append(group);
  desktop.handlers.contextmenu({ target: appShortcut, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} });
  assert.equal(menus.menu.hidden, false);
  listeners.get('click')({ target: desktop });
  assert.equal(menus.menu.hidden, true);
  desktop.handlers.contextmenu({ target: appShortcut, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} });
  listeners.get('keydown')({ key: 'Escape' });
  assert.equal(menus.menu.hidden, true);
  menus.dispose();
});
