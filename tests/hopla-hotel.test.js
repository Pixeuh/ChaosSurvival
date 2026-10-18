import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hoplaHotelData, hoplaHotelRooms } from '../src/browser/sites/hopla-hotel/index.js';
import conversations from '../src/browser/sites/hopla-hotel/conversations.json' with { type: 'json' };
import {
  HOPLA_HOTEL_URL,
  VIEW_WIDTH,
  VIEW_HEIGHT,
  project,
  screenCell,
  blockedCells,
  findPath,
  RoomWalk,
  furnitureCells,
  inside,
} from '../src/browser/sites/hopla-hotel/model.js';
import { depthOrder, drawRoom } from '../src/browser/sites/hopla-hotel/draw.js';
import { renderHoplaHotelRoom } from '../src/browser/sites/hopla-hotel/render.js';
import { HoplaHotelClient } from '../src/browser/sites/hopla-hotel/client.js';
import { WindowManager } from '../src/ui/windows.js';
import { localPages } from '../src/browser/registry.js';
import { BrowserSession } from '../src/browser/session.js';
const room = hoplaHotelData.room;

test('room scenery has no text posters and the lounge has a distinct walkable seating layout', () => {
  const ctx = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {},
    fillText(text) { throw new Error(`decorative room text rendered: ${text}`); },
  };
  for (const definition of hoplaHotelRooms) {
    assert.deepEqual(definition.decor?.posters ?? [], [], `${definition.id} has no text posters`);
    drawRoom(ctx, definition, new RoomWalk(definition));
  }

  const lounge = hoplaHotelRooms.find((definition) => definition.id === 'detente');
  const hall = hoplaHotelRooms.find((definition) => definition.id === 'hall');
  assert.notDeepEqual(lounge.palette, hall.palette);
  assert.ok(lounge.decor.floorAreas.length > 0, 'the lounge has a warm rug');
  assert.ok(lounge.furniture.some((item) => item.type === 'chair'));
  assert.ok(lounge.furniture.filter((item) => item.type === 'sofa').length >= 2);
  const occupied = new Set();
  for (const item of lounge.furniture.filter((item) => item.blocking))
    for (const cell of furnitureCells(item)) {
      assert.ok(!occupied.has(cell.join(':')), `overlapping lounge furniture at ${cell}`);
      occupied.add(cell.join(':'));
    }
  for (const target of [[3, 6], [5, 5], [7, 7]])
    assert.ok(findPath(lounge, lounge.spawn, target), `lounge passage to ${target}`);
  assert.ok(lounge.npcs.every((npc) => !occupied.has(npc.position.join(':'))));
});

test('Hopla Hotel uses only canonical URLs and drops an invalid saved tab without losing other tabs', () => {
  const oldRoom = 'http://www.xdhotel.fr/salle/hall?test=1';
  assert.ok(localPages.resolve(oldRoom, {}).error);
  const saved = {
    version: 1,
    active: 'old',
    tabs: [
      { id: 'old', title: 'Ancien site', history: ['http://www.xdhotel.fr/', oldRoom], cursor: 1 },
      { id: 'mixed', title: 'Hopla Hotel', history: ['http://www.xdhotel.fr/', HOPLA_HOTEL_URL], cursor: 1 },
      { id: 'valid', title: 'Accueil', history: ['http://www.xdsearch.fr/'], cursor: 0 },
    ],
  };
  const progression = { data: { browser: structuredClone(saved) }, save() {} };
  const session = new BrowserSession(progression);
  assert.equal(session.active, 'mixed');
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['mixed', 'valid']);
  assert.deepEqual(session.tabs[0].history, [HOPLA_HOTEL_URL]);
  assert.ok(localPages.resolve(session.address, {}).page);
  assert.deepEqual(saved.tabs[0].history, ['http://www.xdhotel.fr/', oldRoom]);
  for (const address of [
    'xdhotel.fr.evil.example',
    'http://xdhotel.fr@evil.example',
    'javascript:xdhotel.fr',
    'file:///xdhotel.fr',
  ])
    assert.ok(localPages.resolve(address, {}).error);
  const entries = localPages.sites({}).filter((page) => /hotel/.test(page.url));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, HOPLA_HOTEL_URL);
});

test('Hopla Hotel registration uses its canonical host and existing directory/search', () => {
  assert.equal(localPages.resolve('www.hoplahotel.fr', {}).page.url, HOPLA_HOTEL_URL);
  assert.ok(localPages.resolve(`${HOPLA_HOTEL_URL}salle/hall`, {}).page);
  assert.equal(localPages.resolve(`${HOPLA_HOTEL_URL}salle/unknown`, {}).error, 'not-found');
  assert.ok(localPages.sites({}).some((page) => page.url === HOPLA_HOTEL_URL));
  for (const query of ['hopla hotel', 'hotel virtuel'])
    assert.ok(localPages.search(query, {}).some((page) => page.url === HOPLA_HOTEL_URL));
  assert.equal(room.width, 10);
  assert.equal(room.height, 10);
  assert.equal(room.npcs[0].name, 'ReceptionHotel');
  assert.equal(room.npcs[0].dialogue, 'Bienvenue sur Hopla Hotel ! Amuse-toi bien ;)');
});

test('five data-driven rooms have unique IDs, unoccupied spawns, bounded obstacles and connected walkable areas', () => {
  assert.deepEqual(
    hoplaHotelRooms.map((room) => room.name),
    ["Hall de l'hôtel", 'Café Hopla', 'Discothèque', 'Salon détente', 'Salle de jeux'],
  );
  assert.equal(new Set(hoplaHotelRooms.map((room) => room.id)).size, 5);
  for (const definition of hoplaHotelRooms) {
    const route = localPages.resolve(`${HOPLA_HOTEL_URL}salle/${definition.id}`, {});
    assert.ok(route.page);
    assert.equal(route.page.preserveOnTabSwitch, undefined);
    assert.equal(
      new Set(definition.furniture.map((item) => item.id)).size,
      definition.furniture.length,
    );
    const occupied = new Set();
    for (const cell of [
      ...definition.furniture.flatMap(furnitureCells),
      ...definition.npcs.map((npc) => npc.position),
    ]) {
      assert.ok(inside(definition, cell), `${definition.id}: ${cell}`);
      assert.ok(!occupied.has(cell.join(':')), `${definition.id}: overlap ${cell}`);
      occupied.add(cell.join(':'));
    }
    const blocked = blockedCells(definition);
    assert.ok(inside(definition, definition.spawn));
    assert.ok(!blocked.has(definition.spawn.join(':')));
    let accessible = 0;
    for (let x = 0; x < definition.width; x++)
      for (let y = 0; y < definition.height; y++) {
        const path = findPath(definition, definition.spawn, [x, y]);
        if (blocked.has(`${x}:${y}`)) {
          assert.equal(path, null);
          continue;
        }
        assert.ok(path, `${definition.id}: disconnected ${x}:${y}`);
        accessible++;
        assert.ok(path.every((cell) => !blocked.has(cell.join(':'))));
      }
    assert.ok(accessible >= 70);
    const walk = new RoomWalk(definition);
    assert.ok(walk.moveTo([8, 7]));
    for (let i = 0; i < 5; i++) walk.update(100);
    assert.deepEqual(walk.cell, [8, 7]);
  }
});
test('isometric projection and inverse hit tests agree across the floor and reject outside clicks', () => {
  for (let x = 0; x < room.width; x++)
    for (let y = 0; y < room.height; y++) {
      const point = project(x, y, room);
      assert.deepEqual(screenCell(point.x, point.y, room), [x, y]);
      assert.deepEqual(screenCell(point.x + 3, point.y + 1, room), [x, y]);
    }
  for (const [x, y] of [
    [0, 0],
    [400, 0],
    [200, 290],
    [-10, 150],
    [NaN, 20],
  ])
    assert.equal(screenCell(x, y, room), null);
});
test('BFS routes around all furniture footprints and the NPC without leaving the room', () => {
  const path = findPath(room, [0, 6], [4, 6]);
  assert.ok(path.length > 4);
  const blocked = blockedCells(room);
  let previous = [0, 6];
  for (const cell of path) {
    assert.ok(!blocked.has(cell.join(':')));
    assert.equal(Math.abs(cell[0] - previous[0]) + Math.abs(cell[1] - previous[1]), 1);
    previous = cell;
  }
  assert.deepEqual(previous, [4, 6]);
  for (const target of [[-1, 2], [10, 2], [2, 4], [2, 6], room.npcs[0].position])
    assert.equal(findPath(room, room.spawn, target), null);
  assert.deepEqual(findPath(room, room.spawn, room.spawn), []);
  const isolated = {
    width: 3,
    height: 3,
    furniture: [],
    npcs: [],
    blocked: [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  };
  assert.equal(findPath(isolated, [0, 1], [2, 1]), null);
});
test('walk interpolates, faces four directions, and replaces a destination without cutting through obstacles', () => {
  const walk = new RoomWalk(room);
  assert.ok(walk.moveTo([8, 7]));
  walk.update(100);
  assert.ok(walk.position[0] > 7 && walk.position[0] < 8);
  assert.equal(walk.direction, 'east');
  assert.ok(walk.moveTo([6, 7]));
  for (let i = 0; i < 20; i++) walk.update(100);
  assert.deepEqual(walk.cell, [6, 7]);
  assert.equal(walk.direction, 'west');
  for (const [target, direction] of [
    [[6, 6], 'north'],
    [[6, 7], 'south'],
  ]) {
    walk.moveTo(target);
    for (let i = 0; i < 3; i++) walk.update(100);
    assert.deepEqual(walk.cell, target);
    assert.equal(walk.direction, direction);
  }
  assert.equal(walk.moveTo([2, 4]), false);
  assert.deepEqual(walk.cell, [6, 7]);
  assert.equal(walk.moving, false);
  const another = new RoomWalk(room);
  assert.deepEqual(another.cell, room.spawn);
  assert.deepEqual(room.spawn, [7, 7]);
  walk.update(Infinity);
  assert.deepEqual(walk.cell, [6, 7]);
});
test('painter order puts an avatar behind or ahead of furniture according to grid depth', () => {
  const walk = new RoomWalk(room);
  walk.position = [0, 0];
  const back = depthOrder(room, walk);
  assert.ok(
    back.findIndex((entry) => entry.kind === 'player') <
      back.findIndex((entry) => entry.item?.id === 'sofa'),
  );
  walk.position = [9, 9];
  assert.equal(depthOrder(room, walk).at(-1).kind, 'player');
});

function dom(t) {
  const saved = {
    document: globalThis.document,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    observer: globalThis.ResizeObserver,
    timeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    performance: globalThis.performance,
  };
  const frames = new Map(),
    listeners = new Set();
  const positions = new WeakMap();
  const timers = new Map();
  const resizeCallbacks = [];
  let fakeNow = performance.now();
  globalThis.performance = { now: () => fakeNow };
  let serial = 0;
  globalThis.document = {
    hidden: false,
    addEventListener(_name, fn) {
      listeners.add(fn);
    },
    removeEventListener(_name, fn) {
      listeners.delete(fn);
    },
    createElement(tag) {
      const ctx = Object.fromEntries(
        ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'fillText'].map((name) => [
          name,
          () => {},
        ]),
      );
      ctx.fillRect = (x, y, width, height) => {
        if (ctx.fillStyle === '#a284dc' && width === 14 && height === 16)
          positions.set(element, { x: x + 7, y: y + 26 });
      };
      const element = {
        tag,
        children: [],
        style: {
          setProperty(name, value) {
            this[name] = value;
          },
        },
        dataset: {},
        handlers: {},
        classList: { add() {} },
        isConnected: true,
        append(...items) {
          this.children.push(...items);
          for (const item of items) item.parent = this;
        },
        replaceChildren(...items) {
          this.children = items;
        },
        querySelector(selector) {
          return walkTree(this).find((item) => item.className === selector.slice(1));
        },
        remove() {
          this.isConnected = false;
          if (this.parent)
            this.parent.children = this.parent.children.filter((item) => item !== this);
        },
        setAttribute() {},
        focus() {},
        getContext() {
          return ctx;
        },
        getBoundingClientRect() {
          return { left: 20, top: 30, width: VIEW_WIDTH * 2, height: VIEW_HEIGHT * 2 };
        },
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
        removeEventListener(name) {
          delete this.handlers[name];
        },
        set innerHTML(_) {
          throw new Error('Unsafe HTML');
        },
      };
      return element;
    },
  };
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++serial, fn);
    return serial;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.setTimeout = (fn, delay) => {
    timers.set(++serial, { fn, due: fakeNow + delay });
    return serial;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    globalThis.document = saved.document;
    globalThis.requestAnimationFrame = saved.raf;
    globalThis.cancelAnimationFrame = saved.caf;
    globalThis.ResizeObserver = saved.observer;
    globalThis.setTimeout = saved.timeout;
    globalThis.clearTimeout = saved.clearTimeout;
    globalThis.performance = saved.performance;
  });
  return {
    frames,
    listeners,
    timers,
    resize: () => resizeCallbacks.forEach((callback) => callback()),
    position: (canvas) => positions.get(canvas),
    step(now) {
      fakeNow = now;
      const tasks = [...frames.values()];
      frames.clear();
      for (const fn of tasks) fn(now);
      let due;
      do {
        due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
        for (const [id, timer] of due) {
          if (!timers.has(id)) continue;
          timers.delete(id);
          timer.fn();
        }
      } while (due.length);
    },
  };
}
const walkTree = (node) => [node, ...node.children.flatMap(walkTree)];

test('Hopla Hotel welcome panel fills the host window and keeps compact content centered', () => {
  const css = readFileSync(
    new URL('../src/browser/sites/hopla-hotel/styles.css', import.meta.url),
    'utf8',
  );
  const home = css.match(/\.hopla-hotel:not\(\.hotel-room\)\s*\{([^}]+)\}/)?.[1] ?? '';
  const banner =
    css.match(/\.hopla-hotel:not\(\.hotel-room\)\s*>\s*\.hotel-banner\s*\{([^}]+)\}/)?.[1] ?? '';
  const content =
    css.match(/\.hopla-hotel:not\(\.hotel-room\)\s*>\s*\.hotel-banner\s*>\s*\*\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(home, /display:\s*flex/);
  assert.match(home, /height:\s*100%/);
  assert.match(banner, /flex:\s*1 1 auto/);
  assert.match(banner, /justify-content:\s*center/);
  assert.match(banner, /align-items:\s*center/);
  assert.match(banner, /overflow:\s*auto/);
  assert.match(content, /flex-shrink:\s*0/);
  assert.match(content, /max-width:\s*100%/);
});

test('site and room routes only request the desktop client and never mount it in the browser', (t) => {
  dom(t);
  let launches = 0;
  for (const address of [HOPLA_HOTEL_URL, ...hoplaHotelRooms.map((room) => `${HOPLA_HOTEL_URL}salle/${room.id}`)]) {
    const root = localPages.resolve(address, {}).page.render({ openHotel: () => launches++ });
    assert.equal(root.querySelector('.hotel-canvas'), undefined);
    assert.equal(root.querySelector('.hotel-intro'), undefined);
    assert.ok(!walkTree(root).some((item) => item.textContent?.includes('Pose tes valises')));
    const enter = root.querySelector('.hotel-enter');
    assert.equal(enter.dataset.browserLink, undefined);
    enter.handlers.click({ preventDefault() {} });
  }
  assert.equal(launches, 6);
});

test('Hopla Hotel is a singleton with the canonical app ID and cleans up on close/clear', (t) => {
  const clock = dom(t);
  const originalAudio = globalThis.Audio;
  const audioInstances = [];
  globalThis.Audio = class {
    constructor(url) {
      this.src = url;
      this.currentTime = 0;
      this.playCount = 0;
      this.pauseCount = 0;
      audioInstances.push(this);
    }
    play() { this.playCount++; return Promise.resolve(); }
    pause() { this.pauseCount++; }
    removeAttribute() { this.src = ''; }
    load() {}
  };
  t.after(() => { globalThis.Audio = originalAudio; });
  const original = structuredClone(hoplaHotelData);
  const bounds = { minX: 0, minY: -120, maxX: 1000, maxY: 580 };
  const manager = {
    windows: new Map(),
    dragged: new WeakSet(),
    z: 10,
    field: { closest: () => document.createElement('div') },
    spawn(_kind, options) {
      const id = this.windows.size + 1;
      const element = document.createElement('article');
      element.append(Object.assign(document.createElement('div'), { className: 'window-body' }));
      this.windows.set(id, { element, options, onDismiss: options.onDismiss });
      return id;
    },
    movementBounds(element) {
      return {
        ...bounds,
        maxX: bounds.maxX - (element.offsetWidth ?? 0),
        maxY: bounds.maxY - (element.offsetHeight ?? 0),
      };
    },
    close(id) {
      const item = this.windows.get(id);
      item.element.remove();
      item.options.onDismiss();
      this.windows.delete(id);
    },
  };
  const applications = {
    instances: new Map(),
    onWindowState() {},
    attachWindow(kind, id) {
      const instance = {
        id,
        element: manager.windows.get(id).element,
        task: document.createElement('button'),
      };
      this.instances.set(kind, instance);
      return instance;
    },
    restore(instance) {
      instance.element.hidden = false;
      instance.element.style.zIndex = ++manager.z;
      instance.onRestore?.();
    },
  };
  let homes = 0;
  const client = new HoplaHotelClient(manager, applications, () => homes++);
  const first = client.open();
  assert.ok(applications.instances.has('hopla-hotel'));
  assert.equal(applications.instances.size, 1);
  const windowOptions = manager.windows.get(first.id).options;
  assert.equal(windowOptions.resizable, true);
  assert.equal(windowOptions.maximizable, true);
  assert.equal(windowOptions.minWidth, 320);
  assert.equal(windowOptions.minHeight, 220);
  assert.equal(first.element.style.width, '940px');
  assert.equal(first.element.style.height, '658px');
  assert.equal(first.element.style.top, '-99px');
  const windowCss = readFileSync(
    new URL('../src/browser/sites/hopla-hotel/styles.css', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(windowCss.match(/\.desktop \.popup\.hopla-hotel-client\s*\{([^}]+)\}/)?.[1] ?? '', /resize\s*:/);
  assert.equal(audioInstances.length, 0, 'ordinary Hopla Hotel rooms stay silent');
  client.showRoom(hoplaHotelRooms.find((entry) => entry.id === 'cafe'));
  assert.equal(audioInstances.length, 0);
  const discoRoom = hoplaHotelRooms.find((entry) => entry.id === 'discotheque');
  client.showRoom(discoRoom);
  assert.equal(audioInstances.length, 1);
  const disco = audioInstances[0];
  assert.match(disco.src, /producesplatinum-disco-483559\.mp3$/);
  assert.equal(disco.volume, 0.35);
  assert.equal(disco.loop, true);
  assert.equal(disco.playCount, 1);
  client.setMusicVolume(0.5);
  assert.equal(disco.volume, 0.175);
  disco.currentTime = 12;
  client.showRoom(hoplaHotelData.room);
  assert.equal(disco.currentTime, 0, 'leaving the disco resets its track');
  assert.equal(disco.pauseCount, 1);
  assert.equal(audioInstances.length, 1, 'ordinary pages do not start another track');
  client.showRoom(discoRoom);
  assert.equal(disco.playCount, 2, 'reentering the disco restarts its track');
  client.stopMusic();
  assert.equal(disco.currentTime, 0, 'ending the browser session resets the active track');
  assert.equal(client.open(), first);
  assert.equal(disco.playCount, 3, 'returning to Hopla Hotel restarts disco when it is active');
  assert.equal(client.open(), first);
  client.showRoom(hoplaHotelData.room);
  assert.equal(manager.windows.size, 1);
  const canvas = () => first.element.querySelector('.hotel-canvas');
  const move = () => {
    const point = project(8, 7, hoplaHotelData.room);
    canvas().handlers.click({ button: 0, clientX: 20 + point.x * 2, clientY: 30 + point.y * 2 });
  };
  for (const room of hoplaHotelRooms) {
    client.showRoom(room);
    assert.deepEqual(clock.position(canvas()), project(...room.spawn, room));
    move();
    clock.step(0);
    clock.step(100);
    const before = clock.position(canvas());
    first.element.hidden = true;
    first.onMinimize();
    assert.equal(clock.frames.size, 0);
    assert.equal(client.open(), first);
    assert.equal(first.element.hidden, false);
    assert.deepEqual(clock.position(canvas()), before);
    for (let i = 0; i < 6; i++) clock.step(1000 + i * 100);
    assert.deepEqual(clock.position(canvas()), project(8, 7, room));
  }
  first.element.handlers.click({
    target: { closest: () => ({ dataset: { browserLink: HOPLA_HOTEL_URL } }) },
    preventDefault() {},
  });
  assert.equal(homes, 1);
  move();
  manager.close(first.id);
  assert.equal(disco.src, '');
  assert.equal(client.instance, null);
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.listeners.size, 0);
  assert.equal(applications.instances.size, 0);
  const second = client.open();
  assert.notEqual(second, first);
  assert.deepEqual(
    clock.position(second.element.querySelector('.hotel-canvas')),
    project(...hoplaHotelData.room.spawn, hoplaHotelData.room),
  );
  WindowManager.prototype.clear.call(manager);
  assert.equal(client.instance, null);
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.listeners.size, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(applications.instances.size, 0);
  assert.deepEqual(hoplaHotelData, original);
});
test('room instances have independent motion/bubbles; scaled clicks, visibility and disposal clean up all resources', (t) => {
  const clock = dom(t);
  let disposeA, disposeB;
  const a = renderHoplaHotelRoom(
    {
      onDispose: (fn) => {
        disposeA = fn;
      },
    },
    hoplaHotelData,
  );
  const b = renderHoplaHotelRoom(
    {
      onDispose: (fn) => {
        disposeB = fn;
      },
    },
    hoplaHotelData,
  );
  const find = (root, cls) => walkTree(root).find((item) => item.className === cls);
  const canvas = find(a, 'hotel-canvas');
  const click = (x, y) =>
    canvas.handlers.click({ button: 0, clientX: 20 + x * 2, clientY: 30 + y * 2 });
  click(...Object.values(project(8, 7, room)));
  assert.equal(clock.frames.size, 1);
  for (let i = 0; i < 5; i++) clock.step(i * 100);
  assert.deepEqual(clock.position(canvas), project(8, 7, room));
  assert.deepEqual(clock.position(find(b, 'hotel-canvas')), project(...room.spawn, room));
  for (const root of [a, b]) {
    assert.equal(find(root, 'hotel-location'), undefined);
    assert.equal(find(root, 'hotel-room-status'), undefined);
  }
  assert.equal(clock.frames.size, 0);
  const npc = project(...room.npcs[0].position, room);
  click(npc.x, npc.y - 25);
  const greeting = walkTree(a).find((item) =>
    item.className === 'hotel-bubble' && item.dataset.speaker === 'receptionhotel',
  );
  assert.equal(greeting.children[1].textContent, room.npcs[0].dialogue);
  assert.ok(greeting);
  assert.equal(
    walkTree(b).find((item) => item.className === 'hotel-bubble').dataset.speaker,
    'darkflo',
  );
  for (let i = 0; i < 80; i++) clock.step(500 + i * 100);
  assert.equal(
    walkTree(a).includes(greeting),
    false,
    'expired greeting is removed even as ambient speech starts',
  );
  click(...Object.values(project(9, 7, room)));
  document.hidden = true;
  for (const fn of clock.listeners) fn();
  assert.equal(clock.frames.size, 0);
  document.hidden = false;
  for (const fn of clock.listeners) fn();
  disposeA();
  disposeA();
  disposeB();
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.listeners.size, 0);
  assert.equal(canvas.handlers.click, undefined);
});

test('Hopla Hotel room rendering leaves music lifecycle to its client', (t) => {
  const clock = dom(t);
  const originalAudio = globalThis.Audio;
  const instances = [];
  globalThis.Audio = class {
    constructor(url) {
      this.src = url;
      this.currentTime = 9;
      this.volume = 1;
      this.loop = false;
      this.playCount = 0;
      this.pauseCount = 0;
      instances.push(this);
    }
    play() {
      this.playCount++;
      return Promise.resolve();
    }
    pause() { this.pauseCount++; }
    removeAttribute(name) { this.removedAttribute = name; }
    load() { this.loaded = true; }
  };
  t.after(() => {
    globalThis.Audio = originalAudio;
  });

  renderHoplaHotelRoom({ onDispose() {} }, hoplaHotelData);
  renderHoplaHotelRoom(
    { onDispose() {} },
    hoplaHotelData,
    hoplaHotelRooms.find((entry) => entry.id === 'discotheque'),
  );
  assert.equal(instances.length, 0);
  assert.equal(clock.frames.size, 0);
});

test('navigator opens/closes, cancels a moving instance on room changes and repeated mounts leave one listener', (t) => {
  const clock = dom(t);
  let active, cleanup;
  const context = {
    onDispose(fn) {
      cleanup = fn;
    },
    navigate(url) {
      cleanup();
      const definition = hoplaHotelRooms.find((item) => url === `${HOPLA_HOTEL_URL}salle/${item.id}`);
      active = renderHoplaHotelRoom(context, hoplaHotelData, definition);
    },
  };
  active = renderHoplaHotelRoom(context, hoplaHotelData);
  const find = (cls) => walkTree(active).find((item) => item.className === cls);
  for (const definition of [...hoplaHotelRooms, ...hoplaHotelRooms].slice(1)) {
    const point = project(8, 7, room);
    find('hotel-canvas').handlers.click({
      button: 0,
      clientX: 20 + point.x * 2,
      clientY: 30 + point.y * 2,
    });
    assert.equal(clock.frames.size, 1);
    find('hotel-navigator-open').handlers.click();
    assert.equal(find('hotel-navigator').hidden, false);
    assert.equal(clock.frames.size, 0);
    const buttons = walkTree(active).filter((item) => item.dataset.hotelRoom);
    assert.equal(buttons.length, 5);
    find('hotel-navigator-close').handlers.click();
    assert.equal(find('hotel-navigator').hidden, true);
    find('hotel-navigator-open').handlers.click();
    buttons.find((button) => button.dataset.hotelRoom === definition.id).handlers.click();
    assert.equal(find('hotel-navigator').hidden, true);
    assert.equal(find('hotel-current-room').textContent, definition.name);
    assert.equal(find('hotel-room-nav').children.length, 3);
    assert.ok(!walkTree(active).some((item) => item.textContent === "Retour à l'accueil"));
    assert.deepEqual(
      clock.position(find('hotel-canvas')),
      project(...definition.spawn, definition),
    );
    assert.equal(find('hotel-location'), undefined);
    assert.equal(find('hotel-room-status'), undefined);
    assert.equal(clock.frames.size, 0);
    assert.equal(clock.listeners.size, 1);
    const npc = project(...definition.npcs[0].position, definition);
    find('hotel-canvas').handlers.click({
      button: 0,
      clientX: 20 + npc.x * 2,
      clientY: 30 + (npc.y - 25) * 2,
    });
    if (definition.id === 'hall') {
      const receptionBubble = walkTree(active).find((item) =>
        item.className === 'hotel-bubble' && item.dataset.speaker === 'receptionhotel',
      );
      assert.equal(receptionBubble.children[1].textContent, definition.npcs[0].dialogue);
    } else if (definition.id !== 'discotheque') {
      assert.equal(find('hotel-message-text'), undefined, 'ordinary NPC clicks never speak');
    }
    clock.step(performance.now() + 5000);
  }
  cleanup();
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.listeners.size, 0);
});

test('all five rooms show attributed ambient speech without clicks and dispose their scheduled work', (t) => {
  const clock = dom(t);
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  t.after(() => {
    Math.random = originalRandom;
  });
  for (const definition of hoplaHotelRooms) {
    let cleanup;
    const root = renderHoplaHotelRoom(
      {
        onDispose: (fn) => {
          cleanup = fn;
        },
      },
      hoplaHotelData,
      definition,
    );
    const find = (cls) => walkTree(root).find((item) => item.className === cls);
    const spontaneousBubble = () =>
      walkTree(root).find((item) => {
        if (item.className !== 'hotel-bubble') return false;
        const speaker = definition.npcs.find((npc) => npc.id === item.dataset.speaker);
        return speaker?.behavior?.messages?.includes(item.children[1].textContent);
      });
    const immediate = ['hall', 'discotheque'].includes(definition.id);
    assert.equal(Boolean(find('hotel-bubble')), immediate);
    assert.equal(find('hotel-nickname'), undefined);
    const start = performance.now();
    for (let elapsed = 100; elapsed <= 35000 && !spontaneousBubble(); elapsed += 100)
      clock.step(start + elapsed);
    const bubble = spontaneousBubble();
    assert.ok(bubble, `${definition.id}: spontaneous message`);
    assert.equal(bubble.parent.className, 'hotel-messages');
    assert.equal(bubble.style.left, undefined);
    assert.equal(bubble.style.top, undefined);
    const speaker = definition.npcs.find((npc) => npc.id === bubble.dataset.speaker);
    assert.ok(speaker, 'message belongs to this room');
    assert.equal(bubble.children[0].textContent, `${speaker.name} : `);
    assert.ok(find('hotel-message-text').textContent);
    cleanup();
    assert.equal(find('hotel-bubble'), undefined);
    assert.equal(clock.timers.size, 0);
    assert.equal(clock.frames.size, 0);
    assert.equal(clock.listeners.size, 0);
  }
});

test('receptionist presents the two welcome lines in order and only once per room visit', (t) => {
  const clock = dom(t);
  let cleanup;
  const root = renderHoplaHotelRoom({ onDispose: (fn) => (cleanup = fn) }, hoplaHotelData);
  const find = (cls) => walkTree(root).find((item) => item.className === cls);
  const reception = project(...room.npcs[0].position, room);
  const clickReception = () => find('hotel-canvas').handlers.click({
    button: 0,
    clientX: 20 + reception.x * 2,
    clientY: 30 + (reception.y - 25) * 2,
  });
  clickReception();
  const texts = () => walkTree(root)
    .filter((item) => item.className === 'hotel-bubble' && item.dataset.speaker === 'receptionhotel')
    .map((bubble) => bubble.children[1].textContent);
  assert.deepEqual(texts(), ['Bienvenue sur Hopla Hotel ! Amuse-toi bien ;)']);
  clickReception();
  assert.deepEqual(texts(), ['Bienvenue sur Hopla Hotel ! Amuse-toi bien ;)']);
  clock.step(performance.now() + 2200);
  assert.deepEqual(texts(), [
    'Bienvenue sur Hopla Hotel ! Amuse-toi bien ;)',
    "Ici, il n'y a pas de cr\u00e9dits \u00e0 d\u00e9penser ;)",
  ]);
  cleanup();
});

test('hall and disco open with an in-progress exchange and continue it without a pause', (t) => {
  const clock = dom(t);
  for (const id of ['hall', 'discotheque']) {
    let cleanup;
    const definition = hoplaHotelRooms.find((candidate) => candidate.id === id);
    const root = renderHoplaHotelRoom({ onDispose: (fn) => (cleanup = fn) }, hoplaHotelData, definition);
    const messages = () => walkTree(root)
      .filter((item) => item.className === 'hotel-message-text')
      .map((item) => item.textContent);
    const opening = conversations.find((conversation) => conversation.room === id && conversation.opening);
    assert.deepEqual(messages(), [opening.messages[0].text]);
    clock.step(performance.now() + opening.messages[1].delay + 1);
    assert.deepEqual(messages(), [opening.messages[0].text, opening.messages[1].text]);
    cleanup();
  }
});

test('floating navigator drag and resize stay in the scene and cleanup removes its handlers', (t) => {
  const clock = dom(t);
  let cleanup;
  const root = renderHoplaHotelRoom(
    {
      onDispose: (fn) => {
        cleanup = fn;
      },
    },
    hoplaHotelData,
  );
  const find = (cls) => walkTree(root).find((item) => item.className === cls);
  assert.equal(find('hotel-header'), undefined);
  const chatInput = find('hotel-chat-input');
  const chatSpace = find('hotel-chat-space');
  const chatMode = find('hotel-chat-mode');
  assert.equal(chatSpace.children[0].className, 'hotel-chat-mode');
  assert.equal(chatSpace.children[1], chatInput);
  let focused = false;
  chatInput.focus = () => {
    focused = true;
  };
  const messagesBeforeEnter = find('hotel-messages').children.length;
  assert.deepEqual(chatMode.children.map((option) => option.textContent), ['Parler', 'Crier']);
  chatInput.value = 'Bonjour';
  chatInput.handlers.input();
  assert.equal(chatInput.style.fontWeight, 'normal');
  chatMode.value = 'shout';
  chatMode.handlers.change();
  assert.equal(chatInput.value, 'Bonjour', 'changing mode keeps the draft');
  assert.equal(chatInput.style.fontWeight, 'bold');
  chatInput.value = 'Bonjour encore';
  chatInput.handlers.input();
  assert.equal(chatInput.style.fontWeight, 'bold', 'shout mode applies while typing');
  for (const mode of ['shout', 'speak']) {
    chatMode.value = mode;
    chatMode.handlers.change();
    chatInput.value = 'Message temporaire';
    let prevented = false,
      stopped = false;
    chatInput.handlers.keydown({
      key: 'Enter',
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(chatInput.value, '');
    assert.equal(focused, true);
  }
  assert.equal(find('hotel-messages').children.length, messagesBeforeEnter);
  const viewport = find('hotel-viewport'),
    panel = find('hotel-navigator');
  const header = panel.children[0];
  header.setPointerCapture = () => {};
  Object.assign(viewport, { clientWidth: 400, clientHeight: 300 });
  Object.assign(panel, { offsetWidth: 200, offsetHeight: 180 });
  find('hotel-navigator-open').handlers.click();
  header.handlers.pointerdown({
    button: 0,
    pointerId: 1,
    target: header,
    clientX: 30,
    clientY: 40,
    preventDefault() {},
  });
  header.handlers.pointermove({ pointerId: 1, clientX: 1030, clientY: 1040 });
  assert.equal(panel.style.left, '200px');
  assert.equal(panel.style.top, '120px');
  header.handlers.pointerup();
  Object.assign(viewport, { clientWidth: 250, clientHeight: 200 });
  clock.resize();
  assert.equal(panel.style.left, '50px');
  assert.equal(panel.style.top, '20px');
  cleanup();
  assert.equal(header.handlers.pointerdown, undefined);
  assert.equal(header.handlers.pointermove, undefined);
  assert.equal(clock.timers.size, 0);
});

test('early ambient DOM speech resumes after navigator pause and client restoration without extra timers', (t) => {
  const clock = dom(t);
  let cleanup, resume;
  const root = renderHoplaHotelRoom(
    {
      onDispose: (fn) => {
        cleanup = fn;
      },
      onResume: (fn) => {
        resume = fn;
      },
    },
    hoplaHotelData,
  );
  const find = (cls) => walkTree(root).find((item) => item.className === cls);
  const start = performance.now();
  const openingBubble = find('hotel-bubble');
  assert.ok(openingBubble);
  clock.step(start + 1000);
  find('hotel-navigator-open').handlers.click();
  clock.step(start + 20000);
  assert.equal(find('hotel-bubble'), openingBubble);
  assert.equal(clock.timers.size, 0);
  find('hotel-navigator-close').handlers.click();
  for (let elapsed = 100; elapsed <= 7000 && !find('hotel-bubble'); elapsed += 100)
    clock.step(start + 20000 + elapsed);
  const first = find('hotel-bubble');
  assert.ok(first);
  cleanup('pause');
  const pausedAt = performance.now();
  clock.step(pausedAt + 30000);
  assert.ok(walkTree(root).includes(first));
  assert.equal(clock.timers.size, 0);
  resume();
  for (let elapsed = 100; elapsed <= 7000; elapsed += 100) clock.step(pausedAt + 30000 + elapsed);
  assert.equal(walkTree(root).includes(first), false, 'expiration resumes on the room clock');
  assert.ok(find('hotel-bubble'), 'conversation replies resume too');
  assert.ok(clock.timers.size + clock.frames.size <= 1);
  cleanup();
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.frames.size, 0);
});

test('retained room stops frames while another tab is active, ignores visibility wakeups and resumes its own position', (t) => {
  const clock = dom(t);
  let cleanup, resume;
  const root = renderHoplaHotelRoom(
    {
      onDispose(fn) {
        cleanup = fn;
      },
      onResume(fn) {
        resume = fn;
      },
    },
    hoplaHotelData,
  );
  const find = (cls) => walkTree(root).find((item) => item.className === cls);
  assert.equal(find('hotel-nickname'), undefined);
  const point = project(8, 7, room);
  const reception = project(...room.npcs[0].position, room);
  find('hotel-canvas').handlers.click({
    button: 0,
    clientX: 20 + reception.x * 2,
    clientY: 30 + (reception.y - 25) * 2,
  });
  find('hotel-canvas').handlers.click({
    button: 0,
    clientX: 20 + point.x * 2,
    clientY: 30 + point.y * 2,
  });
  clock.step(0);
  clock.step(100);
  const before = clock.position(find('hotel-canvas'));
  cleanup('pause');
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.timers.size, 0);
  const bubblePositions = walkTree(root)
    .filter((node) => node.className === 'hotel-bubble')
    .map((node) => [node.style.left, node.style.top]);
  const viewport = find('hotel-viewport');
  const bounds = viewport.getBoundingClientRect;
  viewport.getBoundingClientRect = () => ({ width: 0, height: 0 });
  clock.resize();
  assert.deepEqual(
    walkTree(root)
      .filter((node) => node.className === 'hotel-bubble')
      .map((node) => [node.style.left, node.style.top]),
    bubblePositions,
  );
  viewport.getBoundingClientRect = bounds;
  document.hidden = false;
  for (const listener of clock.listeners) listener();
  assert.equal(clock.frames.size, 0);
  resume();
  assert.deepEqual(clock.position(find('hotel-canvas')), before);
  assert.equal(clock.frames.size, 1);
  for (let i = 0; i < 5; i++) clock.step(1000 + i * 100);
  assert.deepEqual(clock.position(find('hotel-canvas')), project(8, 7, room));
  cleanup();
  resume();
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.listeners.size, 0);
  assert.equal(clock.timers.size, 0);
});
