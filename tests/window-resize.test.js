import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowManager } from '../src/ui/windows.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.children = [];
    this.textContent = '';
    this.classList = new FakeClassList(this);
    this.isConnected = true;
    this._width = 320;
    this._height = 180;
    this.captures = new Set();
  }
  set className(value) {
    this.classList.values = new Set(value.split(/\s+/).filter(Boolean));
  }
  get className() { return [...this.classList.values].join(' '); }
  set innerHTML(value) {
    this.html = value;
    this.titlebar = new FakeElement('header');
    this.titlebar.className = 'titlebar';
    this.title = new FakeElement('span');
    this.title.className = 'window-title';
    this.titleText = new FakeElement('span');
    this.title.append(this.titleText);
    this.closeButton = new FakeElement('button');
    this.closeButton.className = 'close-button';
    this.titlebar.append(this.title, this.closeButton);
    this.children.push(this.titlebar, this.closeButton);
  }
  get innerHTML() { return this.html; }
  get offsetWidth() { return parseFloat(this.style.width) || this._width; }
  get offsetHeight() { return parseFloat(this.style.height) || this._height; }
  get offsetLeft() { return parseFloat(this.style.left) || 0; }
  get offsetTop() { return parseFloat(this.style.top) || 0; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  append(child) { child.parentElement = this; this.children.push(child); }
  insertBefore(child, target) {
    child.parentElement = this;
    const index = this.children.indexOf(target);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  remove() {
    this.isConnected = false;
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
  }
  querySelector(selector) {
    if (selector === '.titlebar') return this.titlebar;
    if (selector === '.close-button') return this.closeButton;
    if (selector === '.window-title > span') return this.titleText;
    if (selector === '.maximize-button') return this.titlebar.children.find((child) => child.classList.contains('maximize-button')) ?? null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.window-resize-handle')
      return this.children.filter((child) => child.classList.contains('window-resize-handle'));
    if (selector === '.close-button, [data-dismiss]') return [this.closeButton];
    return [];
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

function setup(t) {
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.ResizeObserver;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  let observerCallback;
  globalThis.ResizeObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
  });

  const surface = { left: 30, top: 20, right: 930, bottom: 660 };
  const taskbarRect = { top: 624 };
  const desktop = {
    getBoundingClientRect: () => surface,
    querySelector: () => ({ getBoundingClientRect: () => taskbarRect }),
  };
  const fieldRect = {
    left: 100,
    top: 120,
    right: 900,
    bottom: 520,
    get width() { return this.right - this.left; },
    get height() { return this.bottom - this.top; },
  };
  const field = {
    children: [],
    inert: false,
    append(element) { element.parentElement = this; this.children.push(element); },
    getBoundingClientRect: () => fieldRect,
    get clientWidth() { return fieldRect.right - fieldRect.left; },
    get clientHeight() { return fieldRect.bottom - fieldRect.top; },
    closest: () => desktop,
  };
  const manager = new WindowManager(field, () => {});
  const makeWindow = (options = {}) => {
    const id = manager.spawn('msn', {
      x: 0.5,
      y: 0.5,
      content: { title: 'test', body: '', iconName: 'msn' },
      ...options,
    });
    return { id, item: manager.windows.get(id), element: manager.windows.get(id).element };
  };
  const pointer = (x, y, pointerId = 1) => ({
    button: 0,
    isPrimary: true,
    clientX: x,
    clientY: y,
    pointerId,
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  });
  return { manager, makeWindow, pointer, field, fieldRect, surface, taskbarRect, observerCallback };
}

function handle(element, direction) {
  return element.querySelectorAll('.window-resize-handle')
    .find((candidate) => candidate.dataset.resizeDirection === direction);
}

function resize(element, direction, from, to) {
  const target = handle(element, direction);
  target.dispatch('pointerdown', from);
  target.dispatch('pointermove', to);
  target.dispatch('pointerup', to);
  return { target, from, to };
}

test('windows remain non-resizable and non-maximizable unless explicitly configured', (t) => {
  const { manager, makeWindow, pointer } = setup(t);
  const { id, item, element } = makeWindow();
  assert.equal(element.offsetWidth, 320);
  assert.equal(element.offsetHeight, 180);
  assert.equal(item.resizable, false);
  assert.equal(item.maximizable, false);
  assert.equal(item.maximizeButton, undefined);
  assert.equal(element.classList.contains('window-managed-sizing'), false);
  assert.equal(element.querySelectorAll('.window-resize-handle').length, 0);
  assert.equal(manager.maximize(id), false);

  const bar = element.querySelector('.titlebar');
  bar.dispatch('pointerdown', pointer(300, 260));
  bar.dispatch('pointermove', pointer(350, 280));
  bar.dispatch('pointerup', pointer(350, 280));
  assert.equal(element.style.left, '290px');
  assert.equal(element.style.top, '130px');
});

test('resizing supports all edges and corners, respects minimums and keeps opposite edges fixed', (t) => {
  const { manager, makeWindow, pointer } = setup(t);
  const { item, element } = makeWindow({ x: 0.1, resizable: true, minWidth: 180, minHeight: 100, maxWidth: 600 });
  assert.equal(element.querySelectorAll('.window-resize-handle').length, 8);
  assert.deepEqual(
    element.querySelectorAll('.window-resize-handle').map((entry) => entry.dataset.resizeDirection).sort(),
    ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'],
  );

  const east = resize(element, 'e', pointer(0, 0), pointer(60, 0));
  assert.equal(east.from.defaultPrevented, true);
  assert.equal(east.from.propagationStopped, true);
  assert.equal(element.offsetWidth, 380);
  assert.equal(element.offsetHeight, 180);
  assert.equal(element.offsetLeft, 48);

  resize(element, 'e', pointer(0, 0), pointer(10000, 0));
  assert.equal(element.offsetWidth, 600);
  resize(element, 'w', pointer(0, 0), pointer(220, 0));
  assert.equal(element.offsetWidth, 380);
  assert.equal(element.offsetLeft, 268);

  resize(element, 's', pointer(0, 0), pointer(0, 35));
  assert.equal(element.offsetHeight, 215);
  const cornerLeft = element.offsetLeft;
  const cornerTop = element.offsetTop;
  resize(element, 'nw', pointer(0, 0), pointer(-20, -15));
  assert.equal(element.offsetWidth, 400);
  assert.equal(element.offsetHeight, 230);
  assert.equal(element.offsetLeft, cornerLeft - 20);
  assert.equal(element.offsetTop, cornerTop - 15);

  const rightBeforeWestResize = element.offsetLeft + element.offsetWidth;
  resize(element, 'w', pointer(0, 0), pointer(500, 0));
  assert.equal(element.offsetWidth, 180);
  assert.equal(element.offsetLeft + element.offsetWidth, rightBeforeWestResize);
  assert.ok(element.offsetWidth >= item.minWidth);
  assert.ok(element.offsetHeight >= item.minHeight);

  resize(element, 'e', pointer(0, 0), pointer(10000, 0));
  assert.equal(element.offsetWidth, 830 - element.offsetLeft);
  assert.ok(element.offsetWidth <= 600);
  assert.ok(element.offsetLeft + element.offsetWidth <= 830);
  assert.ok(element.offsetTop + element.offsetHeight <= 504);
  assert.equal(manager.dragged.has(element), true);
});

test('maximization stays inside the desktop work area and restores size and position reliably', (t) => {
  const { manager, makeWindow, pointer, surface, taskbarRect, observerCallback } = setup(t);
  const { id, item, element } = makeWindow({ resizable: true, maximizable: true, minWidth: 200, minHeight: 120 });
  const normal = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };

  assert.equal(manager.maximize(id), true);
  assert.equal(item.maximized, true);
  assert.equal(element.style.left, '-70px');
  assert.equal(element.style.top, '-100px');
  assert.equal(element.offsetWidth, 900);
  assert.equal(element.offsetHeight, 604);
  assert.equal(parseFloat(element.style.top) + element.offsetHeight, taskbarRect.top - 120);
  element.querySelector('.titlebar').dispatch('pointerdown', pointer(300, 260));
  element.querySelector('.titlebar').dispatch('pointermove', pointer(500, 400));
  assert.equal(element.style.left, '-70px');
  const other = makeWindow();
  assert.ok(Number(other.element.style.zIndex) > Number(element.style.zIndex));
  assert.equal(manager.restore(id), true);
  assert.ok(Number(element.style.zIndex) > Number(other.element.style.zIndex));
  assert.deepEqual(
    { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight },
    normal,
  );
  assert.equal(item.maximized, false);

  assert.equal(manager.maximize(id), true);
  surface.right = 800;
  taskbarRect.top = 550;
  manager.reposition();
  assert.equal(element.offsetWidth, 770);
  assert.equal(element.offsetHeight, 530);
  assert.equal(element.style.left, '-70px');
  assert.equal(element.style.top, '-100px');
  observerCallback();
  assert.deepEqual(
    [element.style.left, element.style.top, element.offsetWidth, element.offsetHeight],
    ['-70px', '-100px', 770, 530],
  );
  assert.equal(manager.restore(id), true);
  assert.equal(element.offsetWidth, normal.width);
  assert.equal(element.offsetHeight, normal.height);
  assert.ok(element.offsetLeft >= -70 && element.offsetLeft + element.offsetWidth <= 700);
});

test('maximizable windows expose one accessible button and titlebar double-click toggles state', (t) => {
  const { manager, makeWindow } = setup(t);
  const { id, item, element } = makeWindow({ maximizable: true });
  const button = item.maximizeButton;
  assert.ok(button);
  assert.match(button.innerHTML, /<svg[\s\S]*<path/);
  assert.match(button.innerHTML, /M3 3\.25h10v9\.5H3z/);
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.match(button.attributes['aria-label'], /^Agrandir /);
  button.dispatch('click', { stopPropagation() {} });
  assert.equal(item.maximized, true);
  assert.match(button.innerHTML, /M5 5\.5V2\.75h8\.25V11H11/);
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.match(button.attributes['aria-label'], /^Restaurer /);
  element.hidden = true;
  element.hidden = false;
  assert.match(button.innerHTML, /M5 5\.5V2\.75h8\.25V11H11/);
  button.dispatch('click', { stopPropagation() {} });
  assert.equal(item.maximized, false);
  assert.match(button.innerHTML, /M3 3\.25h10v9\.5H3z/);

  element.querySelector('.titlebar').dispatch('dblclick', { target: { closest: () => null } });
  assert.equal(item.maximized, true);
  assert.match(button.innerHTML, /M5 5\.5V2\.75h8\.25V11H11/);
  manager.reposition();
  assert.match(button.innerHTML, /M5 5\.5V2\.75h8\.25V11H11/);
  element.querySelector('.titlebar').dispatch('dblclick', { target: { closest: () => ({}) } });
  assert.equal(item.maximized, true);
  assert.equal(manager.restore(id), true);
});

test('maximizable windows use real outer dimensions without adding resize handles', (t) => {
  const { manager, makeWindow } = setup(t);
  const { id, element } = makeWindow({ maximizable: true });
  const original = [element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight];
  assert.equal(element.querySelectorAll('.window-resize-handle').length, 0);
  assert.equal(element.classList.contains('window-managed-sizing'), true);
  assert.equal(manager.maximize(id), true);
  assert.equal(element.offsetWidth, 900);
  assert.equal(element.offsetHeight, 604);
  assert.equal(manager.restore(id), true);
  assert.deepEqual(
    [element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight],
    original,
  );
});

test('resized windows stay accessible after desktop resize and remain independent through close', (t) => {
  const { manager, makeWindow, pointer, surface, taskbarRect } = setup(t);
  const first = makeWindow({ resizable: true, minWidth: 100, minHeight: 80 });
  const second = makeWindow({ resizable: true, minWidth: 100, minHeight: 80 });
  resize(first.element, 'se', pointer(0, 0), pointer(180, 100));
  const secondSize = [second.element.offsetWidth, second.element.offsetHeight];

  surface.right = 500;
  taskbarRect.top = 360;
  manager.reposition();
  assert.ok(first.element.offsetWidth <= 470);
  assert.ok(first.element.offsetHeight <= 340);
  assert.ok(first.element.offsetLeft >= -70);
  assert.ok(first.element.offsetTop >= -100);
  assert.deepEqual([second.element.offsetWidth, second.element.offsetHeight], secondSize);

  manager.close(first.id);
  assert.equal(manager.windows.has(first.id), false);
  assert.equal(manager.windows.get(second.id).element, second.element);
  surface.right = 930;
  taskbarRect.top = 624;
  manager.reposition();
  resize(second.element, 'e', pointer(0, 0), pointer(30, 0));
  assert.equal(second.element.offsetWidth, secondSize[0] + 30);
});

test('closing during a resize releases pointer capture and makes later events inert', (t) => {
  const { manager, makeWindow, pointer } = setup(t);
  const { id, element } = makeWindow({ resizable: true });
  const target = handle(element, 'e');
  target.dispatch('pointerdown', pointer(0, 0));
  assert.equal(target.hasPointerCapture(1), true);
  manager.close(id);
  assert.equal(target.hasPointerCapture(1), false);
  assert.equal(element.isConnected, false);
  assert.doesNotThrow(() => target.dispatch('pointermove', pointer(100, 0)));
  assert.equal(manager.windows.size, 0);

  const cleared = makeWindow({ resizable: true });
  const clearTarget = handle(cleared.element, 's');
  clearTarget.dispatch('pointerdown', pointer(0, 0, 2));
  manager.clear();
  assert.equal(clearTarget.hasPointerCapture(2), false);
  assert.equal(cleared.element.isConnected, false);
  assert.equal(manager.windows.size, 0);
});
