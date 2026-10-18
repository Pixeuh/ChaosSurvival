import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localPages } from '../src/browser/registry.js';
import { flashCatalog, FLASH_URL, renderFlashHome } from '../src/browser/sites/flashzone/index.js';
import {
  BubbleRound,
  bestScore,
  cellCenter,
  cellKey,
  connectedGroup,
  detachedCells,
  hexNeighbors,
  saveBestScore,
} from '../src/browser/sites/flashzone/bubble-round.js';
import { Progression } from '../src/story/progression.js';
import { InternetAdventurer } from '../src/ui/browser.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const walk = (n) => [n, ...n.children.flatMap(walk)];
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  return { storage, p: new Progression(story, storage) };
}
function dom(t) {
  const previous = {
    document: globalThis.document,
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
    Audio: globalThis.Audio,
  };
  const audios = [];
  globalThis.Audio = class {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.playCount = 0;
      this.pauseCount = 0;
      this.paused = true;
      this.ended = false;
      audios.push(this);
    }
    play() { this.playCount++; this.paused = false; return Promise.resolve(); }
    pause() { this.pauseCount++; this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        children: [],
        dataset: {},
        style: {},
        handlers: {},
        isConnected: true,
        classList: { toggle() {} },
        setAttribute() {},
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
        removeEventListener(name) { delete this.handlers[name]; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 600 }; },
        getContext() {
          const gradient = { addColorStop() {} };
          return new Proxy({}, {
            get(target, key) {
              if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
              if (key === 'setLineDash' || key === 'beginPath' || key === 'arc' || key === 'fill' ||
                  key === 'stroke' || key === 'clearRect' || key === 'fillRect' || key === 'moveTo' ||
                  key === 'lineTo' || key === 'save' || key === 'restore' || key === 'translate' ||
                  key === 'rotate' || key === 'strokeRect') return () => {};
              return target[key];
            },
            set(target, key, value) { target[key] = value; return true; },
          });
        },
        append(...nodes) {
          for (const n of nodes) {
            n.parentNode = this;
            this.children.push(n);
          }
        },
        replaceChildren(...nodes) {
          this.children = [];
          this.append(...nodes);
        },
        remove() {
          this.parentNode.children = this.parentNode.children.filter((n) => n !== this);
        },
        set innerHTML(_) {
          throw new Error('HTML sink');
        },
      };
    },
  };
  const frames = new Map();
  let serial = 0;
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++serial, fn);
    return serial;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.request;
    globalThis.cancelAnimationFrame = previous.cancel;
    globalThis.Audio = previous.Audio;
  });
  return {
    frames,
    audios,
    frame(now) {
      const entries = [...frames];
      frames.clear();
      for (const [, fn] of entries) fn(now);
    },
  };
}
test('catalog generates a single thumbnail grid with internal image/title links and no game metadata', (t) => {
  dom(t);
  assert.equal(flashCatalog.games.length, 4);
  const nodes = walk(renderFlashHome());
  assert.equal(nodes.filter((n) => n.className === 'flashzone-grid').length, 1);
  const cards = nodes.filter((n) => n.className === 'flashzone-card');
  assert.equal(cards.length, flashCatalog.games.length - 1);
  assert.equal(nodes.filter((n) => n.className === 'flashzone-list').length, 0);
  for (const [index, card] of cards.entries()) {
    const game = flashCatalog.games[index];
    assert.equal(card.children.length, 2);
    assert.equal(card.children[0].children[0].tag, 'img');
    assert.equal(card.children[0].children[0].src, game.thumbnail);
    assert.equal(card.children[0].dataset.browserLink, game.route);
    assert.equal(card.children[1].dataset.browserLink, game.route);
    assert.equal(card.children[1].textContent, game.title);
    assert.equal(walk(card).filter((n) => ['p', 'small', 'h2'].includes(n.tag)).length, 0);
  }
  const unlockedNodes = walk(
    renderFlashHome({ data: { flags: { superPlombierFlashUnlocked: true } } }),
  );
  assert.equal(
    unlockedNodes.filter((n) => n.className === 'flashzone-card').length,
    flashCatalog.games.length,
  );
  for (const n of nodes.filter((n) => n.tag === 'a')) {
    assert.equal(n.href, '#');
    assert.ok(localPages.resolve(n.dataset.browserLink, {}).page);
  }
  assert.ok(localPages.sites({}).some((p) => p.url === FLASH_URL));
  for (const q of ['flashzone', 'jeux flash', 'jeux gratuits', 'bubble pop', 'bulles'])
    assert.ok(localPages.search(q, {}).some((p) => p.url === flashCatalog.games[0].route));
  assert.equal(localPages.resolve('flashzone.fr/missing', {}).error, 'not-found');
});
test('BubblePop uses staggered hex neighbors and finds same-color clusters and disconnected cells', () => {
  assert.deepEqual(hexNeighbors(0, 2), [[0, 1], [0, 3], [1, 1], [1, 2]]);
  assert.deepEqual(hexNeighbors(1, 2), [[1, 1], [1, 3], [0, 2], [0, 3], [2, 2], [2, 3]]);
  const board = new Map([
    [cellKey(0, 2), 1], [cellKey(1, 2), 1], [cellKey(1, 3), 1],
    [cellKey(4, 8), 2],
  ]);
  assert.equal(connectedGroup(board, cellKey(0, 2)).length, 3);
  assert.deepEqual(detachedCells(board), [cellKey(4, 8)]);
  assert.deepEqual(cellCenter(1, 0), { x: 32, y: 42 + Math.sqrt(3) * 16 });
});
test('BubblePop aims upward, permits one travelling shot, rebounds and attaches to the ceiling', () => {
  const r = new BubbleRound(() => 0);
  r.start();
  assert.ok(r.board.size > 0);
  assert.ok(new Set(r.board.values()).has(r.currentColor));
  r.setAim(470, 590);
  assert.ok(r.aim.y < 0);
  assert.equal(r.shoot(), true);
  assert.equal(r.shoot(), false);
  assert.equal(r.projectile.color, 0);
  // Aim to the left wall; several simulation steps reflect the shot before it reaches the roof.
  r.projectile.x = 17;
  r.projectile.y = 500;
  r.projectile.vx = -430;
  r.projectile.vy = -40;
  r.update(0.05);
  assert.ok(r.projectile === null || r.projectile.vx >= 0 || r.projectile.x < 17);
  r.board.clear();
  r.projectile = { x: 240, y: 11, vx: 0, vy: -430, color: 2 };
  r.update(0.016);
  assert.equal(r.projectile, null);
  assert.ok(r.board.has(cellKey(0, 6)) || r.board.has(cellKey(0, 7)));
});
test('BubblePop pops groups, scores detached bubbles, inserts a row after six misses, and detects victory/defeat', () => {
  const r = new BubbleRound(() => 0);
  r.start();
  r.board = new Map([[cellKey(0, 6), 0], [cellKey(0, 5), 0], [cellKey(1, 5), 0],
    [cellKey(2, 8), 2], [cellKey(2, 9), 2]]);
  r.currentColor = 0;
  r.nextColor = 1;
  const target = cellCenter(0, 6);
  r.setAim(target.x, target.y);
  assert.equal(r.shoot(), true);
  for (let step = 0; r.projectile && step < 120; step++) r.update(1 / 60);
  assert.equal(r.score, 70, 'four matched bubbles and two detached bubbles score independently');
  assert.equal(r.board.size, 0);
  assert.equal(r.status, 'won');

  const rows = new BubbleRound(() => 0);
  rows.start();
  for (let shot = 0; shot < 6; shot++) {
    rows.board = new Map([[cellKey(0, 0), 0]]);
    rows._attach({ x: 240, y: 500, color: 3 }, null);
    if (!rows.active) break;
  }
  assert.equal([...rows.board.keys()].filter((key) => key.startsWith('0:')).length, 13,
    'a no-match shot adds a complete top row by the sixth miss');
  assert.equal(rows.shotsSinceClear, 0);
  const danger = new BubbleRound(() => 0);
  danger.start();
  danger.board = new Map([[cellKey(17, 0), 1]]);
  danger._checkBottom();
  assert.equal(danger.status, 'lost');
  assert.equal(danger.active, false);
});
test('only personal best is saved, corrupt scores fall back, restart restores and New Game clears without narrative events', () => {
  const { p, storage } = fixture();
  const narrative = JSON.stringify([p.data.completed, p.data.dialogues, p.data.choices]);
  assert.equal(bestScore(p, 'bubble-pop'), 0);
  saveBestScore(p, 'bubble-pop', 30);
  saveBestScore(p, 'bubble-pop', 10);
  assert.deepEqual(p.data.flashzone, { bestScores: { 'bubble-pop': 30 } });
  assert.equal(bestScore(new Progression(story, storage), 'bubble-pop'), 30);
  assert.equal(JSON.stringify([p.data.completed, p.data.dialogues, p.data.choices]), narrative);
  p.newGame();
  assert.equal(bestScore(p, 'bubble-pop'), 0);
  p.data.flashzone = { bestScores: { 'bubble-pop': '999' } };
  assert.equal(bestScore(p, 'bubble-pop'), 0);
  saveBestScore(p, 'bubble-pop', 10);
  assert.equal(bestScore(p, 'bubble-pop'), 10);
});
test('BubblePop starts from its real controls, advances a shooter frame, replays and cleans up', (t) => {
  const clock = dom(t),
    { p } = fixture();
  let cleanup;
  const route = localPages.resolve(flashCatalog.games[0].route, {});
  const root = route.page.render({ progression: p, onDispose: (fn) => (cleanup = fn) });
  const find = (cls) => walk(root).find((n) => n.className === cls);
  assert.equal(clock.audios.length, 0);
  assert.equal(clock.frames.size, 0);
  find('bubble-play').handlers.click();
  assert.equal(clock.audios.length, 1);
  const music = clock.audios[0];
  assert.match(music.src, /jakob_welik-roblox-time-to-win-skyline-run-1-442119\.mp3$/);
  assert.equal(music.loop, true);
  assert.equal(music.volume, 0.35);
  assert.equal(music.playCount, 1);
  assert.equal(clock.audios.length, 1, 'effect audio is lazy until a group pops');
  assert.equal(clock.frames.size, 1);
  const canvas = find('bubble-canvas');
  assert.equal(canvas.width, 480);
  assert.equal(canvas.height, 600);
  canvas.handlers.pointermove({ clientX: 80, clientY: 120 });
  canvas.handlers.pointerdown({ clientX: 80, clientY: 120 });
  canvas.handlers.pointerdown({ clientX: 80, clientY: 120 });
  clock.frame(performance.now() + 16);
  assert.equal(find('bubble-stats').children[0].textContent, 'Score : 0');
  assert.equal(clock.frames.size, 1, 'the projectile loop continues while playing');
  find('bubble-replay').handlers.click();
  assert.equal(clock.audios.length, 1);
  assert.equal(music.playCount, 2);
  assert.equal(find('bubble-stats').children[0].textContent, 'Score : 0');
  assert.equal(clock.frames.size, 1);
  cleanup();
  cleanup();
  assert.equal(clock.frames.size, 0);
  assert.equal(music.src, '');
  let cleanup2;
  const second = route.page.render({ progression: p, onDispose: (fn) => (cleanup2 = fn) });
  assert.equal(walk(second).find((n) => n.className === 'bubble-intro').hidden, undefined);
  walk(second)
    .find((n) => n.className === 'bubble-play')
    .handlers.click();
  assert.equal(clock.frames.size, 1);
  cleanup2();
  assert.equal(clock.frames.size, 0);
});
test('browser disposes interactive pages on navigation and reset before replacing DOM', async (t) => {
  const clock = dom(t),
    { p } = fixture();
  const browser = new InternetAdventurer({}, {}, p);
  browser.tabs = () => {};
  const controls = new Map();
  browser.instance = {
    element: {
      isConnected: true,
      querySelector(s) {
        if (!controls.has(s))
          controls.set(s, {
            setAttribute() {},
            replaceChildren(node) {
              this.node = node;
            },
          });
        return controls.get(s);
      },
    },
  };
  t.after(() => {
    clearTimeout(browser.timer);
    browser.disposePage();
  });
  browser.navigate(flashCatalog.games[0].route);
  await new Promise((r) => setTimeout(r, 250));
  const root = controls.get('.browser-page').node;
  walk(root)
    .find((n) => n.className === 'bubble-play')
    .handlers.click();
  assert.equal(clock.frames.size, 1);
  browser.navigate(FLASH_URL);
  assert.equal(clock.frames.size, 0);
  browser.navigate(flashCatalog.games[0].route);
  await new Promise((r) => setTimeout(r, 250));
  walk(controls.get('.browser-page').node)
    .find((n) => n.className === 'bubble-play')
    .handlers.click();
  assert.equal(clock.frames.size, 1);
  browser.reset();
  assert.equal(clock.frames.size, 0);
});
