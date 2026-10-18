import { fileIcon, icon } from './icons.js';

const WIDTH = 120;
const HEIGHT = 104;
const MARGIN = 20;
const SYSTEM_SHORTCUT_IDS = new Set(['shortcut:computer', 'shortcut:folder', 'shortcut:bin']);
const INITIAL_SHORTCUT_TARGETS = new Map([
  ['arcade', 'my-games/chaossurvival.exe'],
]);
const INITIAL_ICON_ORDER = [
  'shortcut:bin',
  'shortcut:computer',
  'shortcut:folder',
  'shortcut:msn',
  'shortcut:browser',
  'shortcut:windows-media-play',
  'shortcut:music',
];
const LEGACY_AUTOMATIC_LAYOUTS = [
  {
    'shortcut:bin': { col: 0, row: 0 },
    'shortcut:computer': { col: 0, row: 1 },
    'shortcut:folder': { col: 0, row: 2 },
    'shortcut:msn': { col: 0, row: 3 },
    'shortcut:windows-media-play': { col: 0, row: 4 },
    'shortcut:music': { col: 0, row: 5 },
    'shortcut:browser': { col: 0, row: 6 },
  },
  {
    'shortcut:bin': { col: 0, row: 0 },
    'shortcut:computer': { col: 0, row: 1 },
    'shortcut:folder': { col: 0, row: 2 },
    'shortcut:msn': { col: 0, row: 3 },
    'shortcut:browser': { col: 0, row: 4 },
    'shortcut:music': { col: 0, row: 5 },
  },
];
export function iconCellTop(cell) {
  return MARGIN + cell.row * HEIGHT;
}
const validCell = (cell) =>
  cell &&
  Number.isInteger(cell.col) &&
  Number.isInteger(cell.row) &&
  cell.col >= 0 &&
  cell.row >= 0;
const same = (a, b) => a?.col === b?.col && a?.row === b?.row;

export function iconGrid(width, height, taskbarHeight = 40, iconHeight = 90, iconWidth = 100) {
  const horizontalSpace = Math.max(0, width - MARGIN * 2 - iconWidth);
  const cols = Math.max(1, 1 + Math.round(horizontalSpace / WIDTH));
  return {
    // Spread fixed-size cells evenly between both margins, including the last.
    cols,
    step: cols > 1 ? horizontalSpace / (cols - 1) : WIDTH,
    rows: Math.max(1, 1 + Math.floor((height - taskbarHeight - MARGIN - iconHeight) / HEIGHT)),
  };
}
export function nearestIconCell(x, y, grid) {
  return {
    col: Math.max(0, Math.min(grid.cols - 1, Math.round((x - MARGIN) / grid.step))),
    row: Math.max(0, Math.min(grid.rows - 1, Math.round((y - MARGIN) / HEIGHT))),
  };
}
export function nearestFreeIconCell(x, y, grid, occupied) {
  const cells = [];
  for (let col = 0; col < grid.cols; col++)
    for (let row = 0; row < grid.rows; row++)
      if (!occupied.has(`${col}:${row}`)) cells.push({ col, row });
  cells.sort((a, b) =>
    (MARGIN + a.col * grid.step - x) ** 2 + (MARGIN + a.row * HEIGHT - y) ** 2 -
    ((MARGIN + b.col * grid.step - x) ** 2 + (MARGIN + b.row * HEIGHT - y) ** 2),
  );
  return cells[0] ?? null;
}
export function iconCellLeft(cell, grid, width, iconWidth, edge = 'left') {
  const col = edge === 'right' ? grid.cols - 1 : cell.col;
  return MARGIN + col * grid.step;
}
export function discardLegacyAutomaticPositions(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  let best = null;
  for (const layout of LEGACY_AUTOMATIC_LAYOUTS) {
    const matches = Object.entries(layout).filter(([id, cell]) => {
      const position = saved[id];
      return validCell(position) && position.custom !== true && position.edge !== 'right' && same(position, cell);
    });
    if (matches.length >= 4 && (!best || matches.length > best.matches.length))
      best = { layout, matches };
  }
  if (!best) return false;
  for (const [id] of best.matches) delete saved[id];
  return best.matches.length > 0;
}
export function layoutIconCells(ids, saved, grid) {
  const cells = [];
  for (let col = 0; col < grid.cols; col++)
    for (let row = 0; row < grid.rows; row++) cells.push({ col, row });
  const result = new Map();
  const free = (cell) => ![...result.values()].some((used) => same(used, cell));
  // Reserve existing custom positions before assigning newly unlocked icons.
  const desiredFor = (id) => ({
    col: saved[id].edge === 'right' ? grid.cols - 1 : Math.min(saved[id].col, grid.cols - 1),
    row: Math.min(saved[id].row, grid.rows - 1),
  });
  const inside = (id) =>
    (saved[id].edge === 'right' || saved[id].col < grid.cols) && saved[id].row < grid.rows;
  const stored = ids.filter((id) => Object.hasOwn(saved, id) && validCell(saved[id]));
  // Valid cells keep priority over icons temporarily clamped after a resize.
  stored.sort(
    (a, b) =>
      Number(saved[b].edge === 'right') - Number(saved[a].edge === 'right') ||
      Number(inside(b)) - Number(inside(a)),
  );
  for (const id of stored) {
    const desired = desiredFor(id);
    const cell = free(desired)
      ? desired
      : [...cells]
          .sort(
            (a, b) =>
              Math.abs(a.col - desired.col) +
              Math.abs(a.row - desired.row) -
              Math.abs(b.col - desired.col) -
              Math.abs(b.row - desired.row),
          )
          .find(free);
    if (cell) result.set(id, cell);
  }
  const mediaId = 'shortcut:windows-media-play';
  const arcadeId = 'shortcut:music';
  if (ids.includes(mediaId) && !result.has(mediaId) && result.has(arcadeId)) {
    const gameCell = result.get(arcadeId);
    const cellAbove = { col: gameCell.col, row: gameCell.row - 1 };
    if (cellAbove.row >= 0 && free(cellAbove)) result.set(mediaId, cellAbove);
  }
  const initialIds = INITIAL_ICON_ORDER.filter((id) => ids.includes(id));
  const assignmentOrder = [
    ...initialIds,
    ...ids.filter((id) => !INITIAL_ICON_ORDER.includes(id)),
  ];
  for (const id of assignmentOrder)
    if (!result.has(id)) {
      const cell = cells.find(free);
      if (cell) result.set(id, cell);
    }
  return result;
}

export function rectanglesTouch(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
export function groupIconCells(cells, ids, delta, grid) {
  const group = new Set(ids);
  const occupied = new Set(
    [...cells].filter(([id]) => !group.has(id)).map(([, cell]) => `${cell.col}:${cell.row}`),
  );
  const result = new Map();
  for (const id of group) {
    const previous = cells.get(id);
    if (!previous) return null;
    const cell = { col: previous.col + delta.col, row: previous.row + delta.row };
    if (
      cell.col < 0 ||
      cell.row < 0 ||
      cell.col >= grid.cols ||
      cell.row >= grid.rows ||
      occupied.has(`${cell.col}:${cell.row}`)
    )
      return null;
    result.set(id, cell);
  }
  return result;
}

export class DesktopIcons {
  reset() {
    this.clearShortcutDropPreview();
    this.cancel();
    this.suppressClick = null;
    this.select(null);
    this.refresh();
  }
  constructor(desktop, progression, virtualFilesystem = null) {
    this.desktop = desktop;
    this.progression = progression;
    this.virtualFilesystem = virtualFilesystem;
    this.selectedIds = new Set();
    desktop.classList.add('icon-grid');
    desktop.addEventListener('dragstart', (event) => {
      if (this.button(event.target)) event.preventDefault();
    });
    desktop.addEventListener('pointerdown', (event) => this.down(event));
    desktop.addEventListener('pointermove', (event) => this.move(event));
    desktop.addEventListener('pointerup', (event) => this.up(event));
    desktop.addEventListener('pointercancel', () => this.cancel());
    desktop.addEventListener('lostpointercapture', () => this.cancel());
    for (const type of ['click', 'dblclick'])
      desktop.addEventListener(
        type,
        (event) => {
          const button = this.button(event.target);
          if (button && button === this.suppressClick) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          if (type === 'click' && button) this.select(button);
        },
        true,
      );
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(desktop);
    this.refresh();
  }
  button(target) {
    const button = target.closest?.('[data-shortcut], [data-file-id]');
    return button?.closest('.desktop-icons, .desktop-files') ? button : null;
  }
  id(button) {
    return button.dataset.shortcutId
      ? `shortcut:${button.dataset.shortcutId}`
      : button.dataset.fileId
      ? `file:${button.dataset.fileId}`
      : // Keep the previous saved cell when the music launcher becomes an EXE.
        `shortcut:${button.dataset.shortcut === 'arcade' ? 'music' : button.dataset.shortcut}`;
  }
  buttons() {
    return [...this.desktop.querySelectorAll('.desktop-icons button, .desktop-files button')];
  }
  targetFileId(button) {
    const targetFileId = button?.dataset?.fileId ?? INITIAL_SHORTCUT_TARGETS.get(button?.dataset?.shortcut);
    return typeof targetFileId === 'string' ? targetFileId.toLowerCase() : null;
  }
  removedIds() {
    return Array.isArray(this.progression.data.desktopIconsRemoved)
      ? this.progression.data.desktopIconsRemoved
      : [];
  }
  remove(button) {
    return this.removeMany([button]);
  }
  removeMany(buttons) {
    const ids = [...new Set(buttons
      .filter((button) => button?.dataset?.shortcut || button?.classList?.contains('desktop-virtual-shortcut'))
      .map((button) => this.id(button))
      .filter((id) => id && !SYSTEM_SHORTCUT_IDS.has(id) && !this.removedIds().includes(id)))];
    if (!ids.length) return false;
    // Pin the current layout before an icon leaves the grid so its neighbors stay put.
    for (const [savedId, cell] of this.cells ?? [])
      if (!this.saved[savedId]) this.saved[savedId] = { ...cell, custom: true };
    this.progression.data.desktopIcons = this.saved;
    this.progression.data.desktopIconsRemoved = [...this.removedIds(), ...ids];
    const removedCustom = new Set(ids.filter((id) => id.startsWith('shortcut:user-')));
    if (removedCustom.size)
      this.progression.data.desktopShortcuts = (this.progression.data.desktopShortcuts ?? [])
        .filter((shortcut) => !removedCustom.has(`shortcut:${shortcut.id}`));
    for (const id of ids) this.selectedIds.delete(id);
    this.progression.save();
    this.refresh();
    return true;
  }
  dropTarget(fileId, clientX, clientY) {
    if (this.desktop.inert || !this.virtualFilesystem?.exists(fileId)) return null;
    const target = document.elementFromPoint?.(clientX, clientY);
    if (!target || !this.desktop.contains(target)) return null;
    if (target.closest?.('.popup, .taskbar, .start-menu, #start-menu, .start-panel, .windows-xd-context-menu, .windows-xd-context-confirmation'))
      return null;
    const iconButton = target.closest?.('.desktop-icons button, .desktop-files button');
    if (iconButton)
      return iconButton.dataset.fileId === fileId &&
        (iconButton.dataset.shortcutId || iconButton.classList?.contains('desktop-virtual-shortcut'))
        ? { duplicate: iconButton }
        : null;
    this.refresh();
    const rect = this.desktop.getBoundingClientRect();
    const taskbar = this.desktop.querySelector('.taskbar')?.getBoundingClientRect();
    if (taskbar && clientY >= taskbar.top) return null;
    const occupied = new Set([...this.cells.values()].map((cell) => `${cell.col}:${cell.row}`));
    const cell = nearestFreeIconCell(clientX - rect.left, clientY - rect.top, this.grid, occupied);
    return cell ? { cell } : null;
  }
  clearShortcutDropPreview() {
    this.dropPreview?.remove();
    this.dropPreview = null;
  }
  existingFileIcon(fileId) {
    const target = typeof fileId === 'string' ? fileId.toLowerCase() : '';
    return this.buttons().find((button) => {
      const isShortcut = button.dataset.shortcutId ||
        button.classList?.contains('desktop-virtual-shortcut') ||
        INITIAL_SHORTCUT_TARGETS.has(button.dataset.shortcut);
      return !button.hidden && button.style.visibility !== 'hidden' && isShortcut &&
        this.targetFileId(button) === target;
    }) ?? null;
  }
  updateShortcutDropPreview(fileId, clientX, clientY) {
    this.clearShortcutDropPreview();
    const existing = this.existingFileIcon(fileId);
    if (existing) {
      this.select(existing);
      return true;
    }
    const target = this.dropTarget(fileId, clientX, clientY);
    if (!target) return false;
    if (target.duplicate) {
      this.select(target.duplicate);
      return true;
    }
    const file = this.virtualFilesystem.getFile(fileId);
    const rect = this.desktop.getBoundingClientRect();
    const preview = document.createElement('div');
    preview.className = 'shortcut-drop-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.innerHTML = icon(fileIcon(file));
    const label = document.createElement('span');
    label.textContent = file.name;
    preview.append(label);
    preview.style.left = `${iconCellLeft(target.cell, this.grid, rect.width, 100)}px`;
    preview.style.top = `${iconCellTop(target.cell)}px`;
    this.desktop.append(preview);
    this.dropPreview = preview;
    return true;
  }
  createFileShortcut(fileId, clientX, clientY) {
    this.clearShortcutDropPreview();
    if (!this.virtualFilesystem?.exists(fileId)) return { ok: false, reason: 'missing' };
    const existing = this.existingFileIcon(fileId);
    if (existing) {
      this.select(existing);
      return { ok: true, existing: true };
    }
    const target = this.dropTarget(fileId, clientX, clientY);
    if (!target) return { ok: false, reason: 'invalid-drop' };
    if (target.duplicate) {
      this.select(target.duplicate);
      return { ok: true, existing: true };
    }
    const file = this.virtualFilesystem.getFile(fileId);
    const id = `user-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    const shortcut = { id, targetFileId: file.fileId, name: file.name, icon: fileIcon(file) };
    const shortcuts = Array.isArray(this.progression.data.desktopShortcuts)
      ? this.progression.data.desktopShortcuts
      : [];
    const previousSavedData = this.progression.data.desktopIcons;
    const previousShortcuts = this.progression.data.desktopShortcuts;
    const nextSaved = { ...this.saved };
    for (const [existingId, cell] of this.cells)
      if (!Object.hasOwn(nextSaved, existingId)) nextSaved[existingId] = { ...cell, custom: true };
    nextSaved[`shortcut:${id}`] = { ...target.cell, custom: true };
    this.saved = nextSaved;
    this.progression.data.desktopIcons = nextSaved;
    this.progression.data.desktopShortcuts = [...shortcuts, shortcut];
    if (!this.progression.save()) {
      this.progression.data.desktopIcons = previousSavedData;
      this.progression.data.desktopShortcuts = previousShortcuts;
      this.saved = previousSavedData && typeof previousSavedData === 'object' ? previousSavedData : {};
      return { ok: false, reason: 'save' };
    }
    this.onShortcutsChanged?.();
    return { ok: true, shortcut };
  }
  select(button) {
    this.selectMany(button ? [button] : []);
  }
  selectMany(buttons) {
    this.selectedIds = new Set(buttons.map((button) => this.id(button)));
    for (const item of this.buttons())
      item.setAttribute('aria-pressed', String(this.selectedIds.has(this.id(item))));
  }
  contextSelection(button) {
    if (!this.selectedIds.has(this.id(button))) this.select(button);
    return this.buttons().filter((item) => this.selectedIds.has(this.id(item)));
  }
  deselectMany(buttons) {
    for (const button of buttons) this.selectedIds.delete(this.id(button));
    for (const item of this.buttons())
      item.setAttribute('aria-pressed', String(this.selectedIds.has(this.id(item))));
  }
  backgroundHit(target) {
    return (
      target === this.desktop ||
      target.classList?.contains?.('desktop-wash') ||
      ['.desktop-icons', '.desktop-files', '#playfield'].some(
        (selector) => target === this.desktop.querySelector(selector),
      )
    );
  }
  refresh() {
    this.cancel();
    if (this.runId !== this.progression.data.runId) this.selectedIds.clear();
    this.runId = this.progression.data.runId;
    const saved = this.progression.data.desktopIcons;
    this.saved = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const removed = new Set(this.removedIds());
    const allButtons = this.buttons();
    for (const button of allButtons) button.hidden = removed.has(this.id(button));
    const buttons = allButtons.filter((button) => !button.hidden);
    const rect = this.desktop.getBoundingClientRect();
    this.grid = iconGrid(
      rect.width,
      rect.height,
      this.desktop.querySelector('.taskbar').getBoundingClientRect().height,
      Math.max(0, ...buttons.map((button) => button.offsetHeight)),
      Math.max(0, ...buttons.map((button) => button.offsetWidth)),
    );
    let changed = false;
    if (discardLegacyAutomaticPositions(this.saved)) changed = true;
    // Legacy saves store absolute cells only. Treat their former last column as
    // right-anchored once, then retain that intent on later resizes.
    if (!this.hasRefreshed) {
      for (const id of buttons.map((button) => this.id(button))) {
        const position = this.saved[id];
        if (
          validCell(position) &&
          position.edge !== 'right' &&
          position.col > 0 &&
          position.col >= this.grid.cols - 1
        ) {
          position.edge = 'right';
          changed = true;
        }
      }
      this.hasRefreshed = true;
    }
    this.cells = layoutIconCells(
      buttons.map((button) => this.id(button)),
      this.saved,
      this.grid,
    );
    for (const button of buttons) {
      const id = this.id(button),
        cell = this.cells.get(id);
      button.setAttribute('aria-pressed', String(this.selectedIds.has(id)));
      button.style.visibility = cell ? '' : 'hidden';
      if (!cell) continue;
      button.style.left = `${iconCellLeft(cell, this.grid, rect.width, button.offsetWidth, this.saved[id]?.edge)}px`;
      button.style.top = `${iconCellTop(cell)}px`;
    }
    if (changed && this.progression.hasSave) this.persist();
  }
  persist() {
    this.progression.data.desktopIcons = this.saved;
    this.progression.save();
  }
  down(event) {
    this.suppressClick = null;
    if (event.button !== 0 || this.desktop.inert || this.drag || this.rectangle) return;
    const button = this.button(event.target);
    if (!button) {
      if (!this.backgroundHit(event.target)) return;
      event.preventDefault();
      this.select(null);
      this.rectangle = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      this.desktop.setPointerCapture?.(event.pointerId);
      return;
    }
    if (!this.selectedIds.has(this.id(button))) this.select(button);
    const items = this.buttons()
      .filter((item) => this.selectedIds.has(this.id(item)))
      .map((item) => ({
        button: item,
        left: parseFloat(item.style.left),
        top: parseFloat(item.style.top),
      }));
    this.drag = {
      button,
      items,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    button.setPointerCapture(event.pointerId);
  }
  move(event) {
    if (this.rectangle) return this.moveRectangle(event);
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    let dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    event.preventDefault();
    const rect = this.desktop.getBoundingClientRect();
    const bottom = this.desktop.querySelector('.taskbar').getBoundingClientRect().top - rect.top;
    const left = Math.min(...drag.items.map((item) => item.left));
    const top = Math.min(...drag.items.map((item) => item.top));
    const right = Math.max(...drag.items.map((item) => item.left + item.button.offsetWidth));
    const end = Math.max(...drag.items.map((item) => item.top + item.button.offsetHeight));
    dx = Math.max(-left, Math.min(rect.width - right, dx));
    dy = Math.max(-top, Math.min(bottom - end, dy));
    for (const item of drag.items) {
      item.button.style.transform = `translate(${dx}px, ${dy}px)`;
      item.button.classList.add('is-dragging');
    }
  }
  moveRectangle(event) {
    const selection = this.rectangle;
    if (event.pointerId !== selection.pointer) return;
    if (
      !selection.moved &&
      Math.hypot(event.clientX - selection.x, event.clientY - selection.y) < 6
    )
      return;
    selection.moved = true;
    event.preventDefault();
    const desktop = this.desktop.getBoundingClientRect();
    const bottom = this.desktop.querySelector('.taskbar').getBoundingClientRect().top;
    const x1 = Math.max(desktop.left, Math.min(desktop.right, selection.x));
    const y1 = Math.max(desktop.top, Math.min(bottom, selection.y));
    const x2 = Math.max(desktop.left, Math.min(desktop.right, event.clientX));
    const y2 = Math.max(desktop.top, Math.min(bottom, event.clientY));
    const rect = {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      right: Math.max(x1, x2),
      bottom: Math.max(y1, y2),
    };
    if (!selection.element) {
      selection.element = document.createElement('div');
      selection.element.className = 'desktop-selection';
      selection.element.setAttribute('aria-hidden', 'true');
      this.desktop.append(selection.element);
    }
    Object.assign(selection.element.style, {
      left: `${rect.left - desktop.left}px`,
      top: `${rect.top - desktop.top}px`,
      width: `${rect.right - rect.left}px`,
      height: `${rect.bottom - rect.top}px`,
    });
    this.selectMany(
      this.buttons().filter(
        (button) =>
          button.style.visibility !== 'hidden' &&
          rectanglesTouch(rect, button.getBoundingClientRect()),
      ),
    );
  }
  up(event) {
    if (this.rectangle) {
      if (event.pointerId === this.rectangle.pointer) this.cancel();
      return;
    }
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.moved) {
      this.suppressClick = drag.button;
      const anchor = this.cells.get(this.id(drag.button));
      let delta = {
        col: Math.round((event.clientX - drag.x) / this.grid.step),
        row: Math.round((event.clientY - drag.y) / HEIGHT),
      };
      if (drag.items.length === 1) {
        const desired = nearestIconCell(
          MARGIN + anchor.col * this.grid.step + event.clientX - drag.x,
          parseFloat(drag.button.style.top) + event.clientY - drag.y,
          this.grid,
        );
        delta = { col: desired.col - anchor.col, row: desired.row - anchor.row };
      }
      const moved = groupIconCells(
        this.cells,
        drag.items.map((item) => this.id(item.button)),
        delta,
        this.grid,
      );
      if (moved) {
        for (const [id, cell] of moved) {
          this.saved[id] =
            cell.col === this.grid.cols - 1
              ? { ...cell, edge: 'right', custom: true }
              : { ...cell, custom: true };
        }
        this.persist();
      }
    }
    this.cancel();
    this.refresh();
  }
  cancel() {
    const selection = this.rectangle;
    this.rectangle = null;
    if (selection) {
      selection.element?.remove();
      if (this.desktop.hasPointerCapture?.(selection.pointer))
        this.desktop.releasePointerCapture(selection.pointer);
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    for (const item of drag.items) {
      item.button.style.transform = '';
      item.button.classList.remove('is-dragging');
    }
    if (drag.button.hasPointerCapture(drag.pointer))
      drag.button.releasePointerCapture(drag.pointer);
  }
}
