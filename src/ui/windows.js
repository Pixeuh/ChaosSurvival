import { icon } from './icons.js';
import { createPopupContent } from './popup-content.js';
import { clamp } from '../utils/math.js';
import { chooseWindowPosition } from './window-placement.js';

const MAXIMIZE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3.25h10v9.5H3z M3 4.5h10" /></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 5.5V2.75h8.25V11H11 M2.75 5.5H11v8.25H2.75z" /></svg>';

export class WindowManager {
  constructor(field, onClose) {
    this.field = field;
    this.onClose = onClose;
    this.windows = new Map();
    this.dragged = new WeakSet();
    this.sequence = 0;
    this.z = 10;
    this.observer = new ResizeObserver(() => this.reposition());
    this.observer.observe(field);
  }
  spawn(
    type = 'msn',
    {
      preview = false,
      x,
      y,
      openedAt,
      content,
      onDismiss,
      windowClass = '',
      resizable = false,
      maximizable = false,
      minWidth = 1,
      minHeight = 1,
      maxWidth,
      maxHeight,
    } = {},
  ) {
    const id = ++this.sequence;
    const element = document.createElement('article');
    element.className = `xp-window popup popup-${type}${preview ? ' preview-window' : ''}${windowClass ? ` ${windowClass}` : ''}`;
    element.dataset.windowId = id;
    const { title, body, iconName } = content ?? createPopupContent(type);
    element.innerHTML = /* HTML */ `<header class="titlebar">
        <span class="window-title">${icon(iconName)}<span>${title}</span></span
        ><button class="close-button" aria-label="Fermer ${title}">×</button>
      </header>
      <div class="window-body">${body}</div>`;
    const titlebar = element.querySelector('.titlebar');
    const closeButton = element.querySelector('.close-button');
    element.style.zIndex = ++this.z;
    this.field.append(element);
    const { width, height } = this.field.getBoundingClientRect();
    const maxX = Math.max(0, width - element.offsetWidth);
    const maxY = Math.max(0, height - element.offsetHeight);
    const occupied = [...this.windows.values()].map(({ element: item }) => ({
      x: item.offsetLeft,
      y: item.offsetTop,
      width: item.offsetWidth,
      height: item.offsetHeight,
    }));
    const position = chooseWindowPosition(
      width,
      height,
      element.offsetWidth,
      element.offsetHeight,
      occupied,
      id,
    );
    element.style.left = `${x === undefined ? position.x : clamp(x * maxX, 0, maxX)}px`;
    element.style.top = `${y === undefined ? position.y : clamp(y * maxY, 0, maxY)}px`;
    const item = {
      element,
      preview,
      openedAt,
      onDismiss,
      resizable: Boolean(resizable),
      maximizable: Boolean(maximizable),
      maximized: false,
      minWidth: Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 1,
      minHeight: Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 1,
      maxWidth: Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Infinity,
      maxHeight: Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : Infinity,
      restoreBounds: null,
      cleanupDrag: null,
      cleanupResize: null,
    };
    this.windows.set(id, item);
    element.querySelectorAll('.close-button, [data-dismiss]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.close(id, event.clientX, event.clientY);
      });
    });
    element.addEventListener('pointerdown', () => this.bringToFront(element));
    if (item.maximizable) {
      const maximizeButton = document.createElement('button');
      maximizeButton.className = 'maximize-button';
      maximizeButton.type = 'button';
      maximizeButton.innerHTML = MAXIMIZE_ICON;
      titlebar.insertBefore(maximizeButton, closeButton);
      maximizeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleMaximize(id);
      });
      titlebar.addEventListener('dblclick', (event) => {
        if (event.target.closest('button')) return;
        this.toggleMaximize(id);
      });
      item.maximizeButton = maximizeButton;
      this.syncMaximizeButton(item);
    }
    this.enableDrag(element, item);
    if (item.resizable || item.maximizable) this.preserveOuterSize(element);
    if (item.resizable) this.enableResize(element, item);
    return id;
  }
  close(id, x, y) {
    const item = this.windows.get(id);
    if (!item || this.field.inert) return;
    if (item.beforeClose?.() === false) return;
    this.windows.delete(id);
    item.cleanupDrag?.();
    item.cleanupResize?.();
    item.element.remove();
    item.onDismiss?.({ reason: 'close' });
    this.onClose({ preview: item.preview, openedAt: item.openedAt, x, y });
  }
  activeWindow() {
    let active = null;
    for (const item of this.windows.values()) {
      if (!item.element.isConnected || item.element.hidden) continue;
      if (!active || Number(item.element.style.zIndex) > Number(active.style.zIndex))
        active = item.element;
    }
    return active;
  }
  isActive(element) {
    return Boolean(element?.isConnected && !element.hidden && this.activeWindow() === element);
  }
  clear() {
    for (const { element, onDismiss, cleanupDrag, cleanupResize } of this.windows.values()) {
      cleanupDrag?.();
      cleanupResize?.();
      element.remove();
      onDismiss?.({ reason: 'clear' });
    }
    this.windows.clear();
  }
  reposition() {
    const occupied = [];
    for (const [id, item] of this.windows) {
      const { element, preview } = item;
      if (item.maximized) {
        this.applyWorkArea(element);
        occupied.push({
          x: parseFloat(element.style.left) || 0,
          y: parseFloat(element.style.top) || 0,
          width: element.offsetWidth,
          height: element.offsetHeight,
        });
        continue;
      }
      if (item.resizable) this.fitResizableWindow(item);
      const bounds = this.movementBounds(element);
      const position =
        preview || this.dragged.has(element)
          ? {
              x: clamp(parseFloat(element.style.left) || 0, bounds.minX, bounds.maxX),
              y: clamp(parseFloat(element.style.top) || 0, bounds.minY, bounds.maxY),
            }
          : chooseWindowPosition(
              this.field.clientWidth,
              this.field.clientHeight,
              element.offsetWidth,
              element.offsetHeight,
              occupied,
              id,
            );
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
      occupied.push({ ...position, width: element.offsetWidth, height: element.offsetHeight });
    }
  }
  movementBounds(element) {
    // Keep spawn coordinates in the playfield, but drag across the actual desktop.
    // Negative local coordinates reach the space above the arcade's playfield.
    const area = this.workArea();
    const minX = area.left;
    const minY = area.top;
    return {
      minX,
      minY,
      maxX: Math.max(minX, area.right - element.offsetWidth),
      maxY: Math.max(minY, area.bottom - element.offsetHeight),
    };
  }
  workArea() {
    const field = this.field.getBoundingClientRect();
    const desktop = this.field.closest('.desktop');
    const surface = desktop?.getBoundingClientRect() ?? field;
    const taskbarTop = desktop?.querySelector('.taskbar')?.getBoundingClientRect().top;
    return {
      left: surface.left - field.left,
      top: surface.top - field.top,
      right: surface.right - field.left,
      bottom: (taskbarTop ?? surface.bottom) - field.top,
    };
  }
  enableDrag(element, item = this.itemFor(element)) {
    const bar = element.querySelector('.titlebar');
    let drag = null;
    bar.addEventListener('pointerdown', (event) => {
      if (drag || event.button !== 0 || event.target.closest('button')) return;
      if (item?.maximized) return;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: element.offsetLeft,
        top: element.offsetTop,
      };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId || item?.maximized) return;
      const bounds = this.movementBounds(element);
      this.dragged.add(element);
      element.style.left = `${clamp(drag.left + event.clientX - drag.x, bounds.minX, bounds.maxX)}px`;
      element.style.top = `${clamp(drag.top + event.clientY - drag.y, bounds.minY, bounds.maxY)}px`;
    });
    const endDrag = (event) => {
      if (drag && event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
      const pointerId = drag?.pointerId;
      drag = null;
      try {
        if (bar.hasPointerCapture?.(pointerId)) bar.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    bar.addEventListener('lostpointercapture', endDrag);
    if (item) item.cleanupDrag = endDrag;
  }
  enableResize(element, item = this.itemFor(element)) {
    if (!item?.resizable) return;
    element.classList.add('window-resizable');
    const directions = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    let operation = null;
    const handles = directions.map((direction) => {
      const handle = document.createElement('div');
      handle.className = `window-resize-handle window-resize-${direction}`;
      handle.dataset.resizeDirection = direction;
      handle.setAttribute('aria-hidden', 'true');
      element.append(handle);

      const endResize = (event) => {
        if (!operation || (event?.pointerId !== undefined && event.pointerId !== operation.pointerId))
          return;
        const pointerId = operation.pointerId;
        const captureHandle = operation.handle;
        operation = null;
        try {
          if (captureHandle.hasPointerCapture?.(pointerId)) captureHandle.releasePointerCapture(pointerId);
        } catch {
          // Pointer capture can already be released by the browser on cancellation.
        }
      };
      handle.addEventListener('pointerdown', (event) => {
        if (operation || event.button !== 0 || event.isPrimary === false || item.maximized) return;
        event.preventDefault();
        event.stopPropagation();
        this.bringToFront(element);
        operation = {
          pointerId: event.pointerId,
          handle,
          direction,
          x: event.clientX,
          y: event.clientY,
          left: element.offsetLeft,
          top: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        };
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is not available in every embedded browser.
        }
      });
      handle.addEventListener('pointermove', (event) => {
        if (!operation || event.pointerId !== operation.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        this.resizeFromPointer(item, operation, event.clientX, event.clientY);
      });
      handle.addEventListener('pointerup', endResize);
      handle.addEventListener('pointercancel', endResize);
      handle.addEventListener('lostpointercapture', endResize);
      return { handle, endResize };
    });
    item.cleanupResize = () => {
      for (const { endResize } of handles) endResize();
    };
  }
  resizeFromPointer(item, operation, clientX, clientY) {
    if (
      item.maximized ||
      !item.element.isConnected ||
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY)
    )
      return;
    const area = this.workArea();
    const direction = operation.direction;
    const movesWest = direction.includes('w');
    const movesEast = direction.includes('e');
    const movesNorth = direction.includes('n');
    const movesSouth = direction.includes('s');
    const fixedRight = operation.left + operation.width;
    const fixedBottom = operation.top + operation.height;
    const availableWidth = Math.max(1, area.right - area.left);
    const availableHeight = Math.max(1, area.bottom - area.top);
    const minWidth = Math.min(item.minWidth, availableWidth);
    const minHeight = Math.min(item.minHeight, availableHeight);
    const maxWidth = Math.max(minWidth, Math.min(item.maxWidth, availableWidth));
    const maxHeight = Math.max(minHeight, Math.min(item.maxHeight, availableHeight));
    let width = operation.width;
    let height = operation.height;
    if (movesWest || movesEast) {
      const maxByPosition = movesWest ? fixedRight - area.left : area.right - operation.left;
      width = clamp(
        operation.width + (movesWest ? -1 : 1) * (clientX - operation.x),
        minWidth,
        Math.max(minWidth, Math.min(maxWidth, maxByPosition)),
      );
    }
    if (movesNorth || movesSouth) {
      const maxByPosition = movesNorth ? fixedBottom - area.top : area.bottom - operation.top;
      height = clamp(
        operation.height + (movesNorth ? -1 : 1) * (clientY - operation.y),
        minHeight,
        Math.max(minHeight, Math.min(maxHeight, maxByPosition)),
      );
    }
    const left = movesWest ? fixedRight - width : operation.left;
    const top = movesNorth ? fixedBottom - height : operation.top;
    item.element.style.width = `${width}px`;
    item.element.style.height = `${height}px`;
    item.element.style.left = `${clamp(left, area.left, Math.max(area.left, area.right - width))}px`;
    item.element.style.top = `${clamp(top, area.top, Math.max(area.top, area.bottom - height))}px`;
    this.dragged.add(item.element);
  }
  maximize(id) {
    const item = this.windows.get(id);
    if (!item?.maximizable || !item.element.isConnected) return false;
    this.bringToFront(item.element);
    item.cleanupDrag?.();
    item.cleanupResize?.();
    if (!item.maximized) {
      item.restoreBounds = {
        left: item.element.offsetLeft,
        top: item.element.offsetTop,
        width: item.element.offsetWidth,
        height: item.element.offsetHeight,
      };
      item.maximized = true;
      item.element.classList.add('window-maximized');
      this.syncMaximizeButton(item);
    }
    this.applyWorkArea(item.element);
    return true;
  }
  restore(id) {
    const item = this.windows.get(id);
    if (!item?.maximized || !item.restoreBounds || !item.element.isConnected) return false;
    this.bringToFront(item.element);
    item.maximized = false;
    item.element.classList.remove('window-maximized');
    this.syncMaximizeButton(item);
    const area = this.workArea();
    const width = this.constrainDimension(item.restoreBounds.width, item.minWidth, item.maxWidth, area.right - area.left);
    const height = this.constrainDimension(item.restoreBounds.height, item.minHeight, item.maxHeight, area.bottom - area.top);
    item.element.style.width = `${width}px`;
    item.element.style.height = `${height}px`;
    item.element.style.left = `${clamp(item.restoreBounds.left, area.left, Math.max(area.left, area.right - width))}px`;
    item.element.style.top = `${clamp(item.restoreBounds.top, area.top, Math.max(area.top, area.bottom - height))}px`;
    this.dragged.add(item.element);
    item.restoreBounds = null;
    return true;
  }
  toggleMaximize(id) {
    const item = this.windows.get(id);
    if (!item?.maximizable) return false;
    return item.maximized ? this.restore(id) : this.maximize(id);
  }
  syncMaximizeButton(item) {
    if (!item?.maximizeButton) return;
    item.maximizeButton.innerHTML = item.maximized ? RESTORE_ICON : MAXIMIZE_ICON;
    item.maximizeButton.setAttribute('aria-label',
      `${item.maximized ? 'Restaurer' : 'Agrandir'} ${item.element.querySelector('.window-title > span')?.textContent ?? 'la fenêtre'}`,
    );
    item.maximizeButton.setAttribute('aria-pressed', String(item.maximized));
  }
  itemFor(element) {
    return [...this.windows.values()].find((item) => item.element === element);
  }
  bringToFront(element) {
    element.style.zIndex = ++this.z;
  }
  preserveOuterSize(element) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    element.classList.add('window-managed-sizing');
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  constrainDimension(value, minimum, maximum, available) {
    const size = Math.max(1, available);
    const min = Math.min(minimum, size);
    const max = Math.max(min, Math.min(maximum, size));
    return clamp(Number.isFinite(value) ? value : min, min, max);
  }
  setSize(element, width, height) {
    if (Math.abs(element.offsetWidth - width) > 0.5) element.style.width = `${width}px`;
    if (Math.abs(element.offsetHeight - height) > 0.5) element.style.height = `${height}px`;
  }
  applyWorkArea(element) {
    const area = this.workArea();
    this.setSize(element, Math.max(1, area.right - area.left), Math.max(1, area.bottom - area.top));
    element.style.left = `${area.left}px`;
    element.style.top = `${area.top}px`;
  }
  fitResizableWindow(item) {
    const area = this.workArea();
    const width = this.constrainDimension(item.element.offsetWidth, item.minWidth, item.maxWidth, area.right - area.left);
    const height = this.constrainDimension(item.element.offsetHeight, item.minHeight, item.maxHeight, area.bottom - area.top);
    this.setSize(item.element, width, height);
  }
}
