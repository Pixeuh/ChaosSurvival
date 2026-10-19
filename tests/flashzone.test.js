import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localPages } from '../src/browser/registry.js';
import { flashCatalog, FLASH_URL, renderFlashHome } from '../src/browser/sites/flashzone/index.js';
import {
  BubbleCampaign,
  BubbleRound,
  BUBBLE_DIFFICULTIES,
  BUBBLE_RADIUS,
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
test('BubblePop pops groups, scores detached bubbles, inserts rows at the configured threshold, and detects victory/defeat', () => {
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
  rows.start('facile');
  for (let shot = 0; shot < 8; shot++) {
    rows.board = new Map([[cellKey(0, 0), 0]]);
    rows._attach({ x: 240, y: 500, color: 3 }, null);
    if (!rows.active) break;
  }
  assert.equal([...rows.board.keys()].filter((key) => key.startsWith('0:')).length, 13,
    'a no-match shot adds a complete top row by the eighth miss');
  assert.equal(rows.shotsSinceClear, 0);
  const danger = new BubbleRound(() => 0);
  danger.start();
  danger.board = new Map([[cellKey(17, 0), 1]]);
  danger._checkBottom();
  assert.equal(danger.status, 'lost');
  assert.equal(danger.active, false);
});
test('BubblePop difficulty configurations generate valid anchored hex rows and tune speed and row thresholds', () => {
  const expected = [
    ['facile', 3, 4, 8, 430],
    ['moyen', 5, 6, 5, 430 * 1.2],
    ['extreme', 6, 8, 3, 430 * 1.4],
  ];
  for (const [id, colors, rowCount, misses, speed] of expected) {
    const round = new BubbleRound(() => 0, id);
    round.start();
    assert.deepEqual(
      [round.config.colorCount, round.config.initialRows, round.config.missesBeforeRow, round.shotSpeed],
      [colors, rowCount, misses, speed],
    );
    assert.equal(round.board.size, rowCount * 13);
    assert.equal(new Set(round.board.values()).size, colors);
    assert.deepEqual(detachedCells(round.board), [], `${id} starts fully connected to the ceiling`);
    for (const color of new Set(round.board.values())) {
      assert.ok(
        [...round.board].some(([key, value]) => value === color && connectedGroup(round.board, key).length >= 3),
        `${id} has a reachable-size match for color ${color}`,
      );
    }
    for (const key of round.board.keys()) {
      const [row, col] = key.split(':').map(Number);
      assert.ok(row >= 0 && row < rowCount && col >= 0 && col < 13);
      const { x, y } = cellCenter(row, col);
      assert.ok(x >= BUBBLE_RADIUS && x <= 480 - BUBBLE_RADIUS);
      assert.ok(y >= 0 && y < 600 - 72);
    }
    round.shoot();
    assert.ok(Math.abs(Math.hypot(round.projectile.vx, round.projectile.vy) - speed) < 1e-6);
  }
  assert.equal(BUBBLE_DIFFICULTIES.extreme.pattern.length, 13);
});
test('each BubblePop difficulty keeps match, miss-row, and win/loss rules', () => {
  for (const [id, config] of Object.entries(BUBBLE_DIFFICULTIES)) {
    const misses = new BubbleRound(() => 0);
    misses.start(id);
    for (let shot = 0; shot < config.missesBeforeRow; shot++) {
      misses.board = new Map([[cellKey(0, 0), 0]]);
      misses._attach({ x: 240, y: 500, color: 1 }, null);
      if (shot < config.missesBeforeRow - 1)
        assert.ok([...misses.board.keys()].filter((key) => key.startsWith('0:')).length < 13);
    }
    assert.equal([...misses.board.keys()].filter((key) => key.startsWith('0:')).length, 13);
    assert.equal(misses.shotsSinceClear, 0);

    const match = new BubbleRound(() => 0);
    match.start(id);
    match.board = new Map([[cellKey(0, 5), 0], [cellKey(0, 6), 0]]);
    match._attach({ ...cellCenter(0, 7), color: 0 }, null);
    assert.equal(match.status, 'won');
    assert.equal(match.score, 30);
    assert.equal(match.shotsSinceClear, 0);

    const loss = new BubbleRound(() => 0, id);
    loss.start();
    loss.board = new Map([[cellKey(17, 0), 1]]);
    loss._checkBottom();
    assert.equal(loss.status, 'lost');
    assert.equal(loss.active, false);
  }
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
test('BubblePop opens directly at level 1 with its announcement and one animation loop', (t) => {
  const clock = dom(t),
    { p } = fixture();
  let cleanup;
  const route = localPages.resolve(flashCatalog.games[0].route, {});
  const root = route.page.render({ progression: p, onDispose: (fn) => (cleanup = fn) });
  const find = (cls) => walk(root).find((n) => n.className === cls);
  assert.equal(clock.audios.length, 1);
  const music = clock.audios[0];
  assert.match(music.src, /jakob_welik-roblox-time-to-win-skyline-run-1-442119\.mp3$/);
  assert.equal(music.loop, true);
  assert.equal(music.volume, 0.35);
  assert.equal(music.playCount, 1);
  assert.equal(clock.audios.length, 1, 'effect audio is lazy until a group pops');
  assert.equal(clock.frames.size, 1);
  assert.equal(find('bubble-stats').children[0].textContent, 'NIVEAU 1 / 3');
  assert.equal(find('bubble-stats').children[1].textContent, 'Score : 0');
  assert.equal(find('bubble-level-announcement').children[0].textContent, 'NIVEAU 1');
  assert.equal(find('bubble-level-announcement').children[1].textContent, 'Échauffement !');
  assert.equal(find('bubble-level-transition').hidden, true);
  assert.equal(walk(root).some((n) => (n.className ?? '').includes('bubble-difficulty')), false);
  assert.equal(walk(root).some((n) => n.className === 'bubble-change-difficulty'), false);
  find('bubble-continue').handlers.click();
  assert.equal(find('bubble-stats').children[0].textContent, 'NIVEAU 1 / 3',
    'Continue cannot bypass winning the current level');
  assert.equal(clock.frames.size, 1);
  const canvas = find('bubble-canvas');
  assert.equal(canvas.width, 480);
  assert.equal(canvas.height, 600);
  canvas.handlers.pointermove({ clientX: 80, clientY: 120 });
  canvas.handlers.pointerdown({ clientX: 80, clientY: 120 });
  const now = performance.now() + 100;
  clock.frame(now);
  assert.equal(find('bubble-level-announcement').hidden, false);
  assert.equal(clock.frames.size, 1);
  clock.frame(now + 1200);
  assert.equal(find('bubble-level-announcement').hidden, true);
  assert.equal(clock.frames.size, 1);
  assert.equal(p.data.flashzone?.bestScores?.['bubble-pop'], undefined,
    'opening or beginning a level does not save intermediate campaign progress');
  cleanup();
  cleanup();
  assert.equal(clock.frames.size, 0);
  assert.equal(music.src, '');
  let cleanup2;
  const second = route.page.render({ progression: p, onDispose: (fn) => (cleanup2 = fn) });
  assert.equal(walk(second).find((n) => n.className === 'bubble-stats').children[0].textContent, 'NIVEAU 1 / 3');
  assert.equal(clock.frames.size, 1);
  cleanup2();
  assert.equal(clock.frames.size, 0);
});
test('BubblePop transition and result screens use the gameplay stage inside a fixed browser viewport', () => {
  const browserCss = readFileSync(new URL('../src/styles-browser.css', import.meta.url), 'utf8');
  const flashzoneCss = readFileSync(
    new URL('../src/browser/sites/flashzone/styles.css', import.meta.url),
    'utf8',
  );
  const windowRule = browserCss.match(/\.desktop \.popup\.internet-adventurer\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(windowRule, /height:\s*470px/);
  assert.match(windowRule, /width:\s*min\(740px, 100%\)/);
  assert.match(browserCss, /\.browser-page:has\(\.bubble-pop\)\s*\{\s*contain:\s*size;/);
  const arena = flashzoneCss.match(/\.bubble-arena\s*\{([^}]+)\}/)?.[1] ?? '';
  const screens = ['bubble-level-transition', 'bubble-result'].map((name) =>
    flashzoneCss.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))?.[1] ?? '',
  );
  assert.match(arena, /width:\s*min\(100%, 480px\)/);
  assert.match(arena, /aspect-ratio:\s*4\s*\/\s*5/);
  for (const screen of screens) {
    assert.match(screen, /width:\s*min\(100%, 480px\)/);
    assert.match(screen, /aspect-ratio:\s*4\s*\/\s*5/);
  }
});
test('BubblePop campaign gates the three levels, accumulates score, and resets after defeat or replay', () => {
  const campaign = new BubbleCampaign();
  assert.deepEqual([campaign.level, campaign.difficulty, campaign.score], [1, 'facile', 0]);
  assert.equal(campaign.continue(), false, 'no level can be selected before a win');
  assert.equal(campaign.completeLevel(1200), 'transition');
  assert.deepEqual([campaign.level, campaign.difficulty, campaign.score], [1, 'facile', 1200]);
  assert.equal(campaign.continue(), true);
  assert.deepEqual([campaign.level, campaign.difficulty, campaign.score], [2, 'moyen', 1200]);
  assert.equal(campaign.continue(), false, 'level 3 cannot be accessed before level 2 is won');
  assert.equal(campaign.completeLevel(2400), 'transition');
  assert.equal(campaign.continue(), true);
  assert.deepEqual([campaign.level, campaign.difficulty, campaign.score], [3, 'extreme', 3600]);
  assert.equal(campaign.completeLevel(3100), 'won');
  assert.deepEqual([campaign.level, campaign.state, campaign.score], [3, 'won', 6700]);
  assert.equal(campaign.continue(), false);
  campaign.reset();
  assert.deepEqual([campaign.level, campaign.difficulty, campaign.score], [1, 'facile', 0]);

  campaign.continue();
  campaign.completeLevel(1200);
  campaign.continue();
  assert.equal(campaign.lose(450), true);
  assert.deepEqual([campaign.level, campaign.state, campaign.score], [2, 'lost', 1650]);
  assert.equal(campaign.continue(), false);
  campaign.reset();
  assert.deepEqual([campaign.level, campaign.state, campaign.score], [1, 'playing', 0]);
  campaign.completeLevel(100);
  campaign.continue();
  campaign.completeLevel(200);
  campaign.continue();
  assert.equal(campaign.lose(300), true);
  assert.deepEqual([campaign.level, campaign.state, campaign.score], [3, 'lost', 600]);
  assert.equal(campaign.continue(), false);
  campaign.reset();
  assert.deepEqual([campaign.level, campaign.state, campaign.score], [1, 'playing', 0]);
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
  assert.equal(clock.frames.size, 1);
  assert.equal(walk(root).find((n) => n.className === 'bubble-stats').children[0].textContent, 'NIVEAU 1 / 3');
  browser.navigate(FLASH_URL);
  assert.equal(clock.frames.size, 0);
  browser.navigate(flashCatalog.games[0].route);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(walk(controls.get('.browser-page').node)
    .find((n) => n.className === 'bubble-stats').children[0].textContent, 'NIVEAU 1 / 3');
  assert.equal(clock.frames.size, 1);
  browser.reset();
  assert.equal(clock.frames.size, 0);
});
