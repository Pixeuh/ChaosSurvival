import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_URL, normalizeUrl, PageRegistry, localPages } from '../src/browser/registry.js';
import { BrowserSession } from '../src/browser/session.js';
import { InternetAdventurer } from '../src/ui/browser.js';
import { renderSearch } from '../src/browser/pages/xd-search.js';
import { renderError } from '../src/browser/pages/error.js';
import { Progression } from '../src/story/progression.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const progression = new Progression(story, storage);
  return { progression, storage, session: new BrowserSession(progression) };
}

test('Internet Adventurer opts into managed resizing at its existing initial size', (t) => {
  const { progression } = fixture();
  const previousResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousResizeObserver;
  });

  const form = { addEventListener() {} };
  const classes = new Set();
  const element = {
    isConnected: true,
    classList: { add: (...names) => names.forEach((name) => classes.add(name)) },
    addEventListener() {},
    querySelector(selector) {
      assert.equal(selector, '.browser-address');
      return form;
    },
  };
  let spawnOptions;
  let spawnCount = 0;
  const manager = {
    dragged: new Set(),
    spawn(type, options) {
      assert.equal(type, 'desktopapp');
      spawnCount++;
      spawnOptions = options;
      return 1;
    },
    movementBounds: () => ({ minX: 0, maxX: 100, minY: 0, maxY: 100 }),
  };
  const instance = { id: 1, element, task: { remove() {} } };
  const applications = {
    instances: new Map(),
    attachWindow() { return instance; },
    restore() {},
    onWindowState() {},
  };
  const browser = new InternetAdventurer(manager, applications, progression);
  browser.load = () => {};
  browser.open();

  assert.equal(spawnOptions.windowClass, 'internet-adventurer');
  assert.equal(spawnOptions.resizable, true);
  assert.equal(spawnOptions.maximizable, true);
  assert.equal(spawnOptions.minWidth, 320);
  assert.equal(spawnOptions.minHeight, 240);
  assert.ok(classes.has('internet-adventurer'));
  assert.equal(browser.session.address, HOME_URL);

  const openInstance = browser.instance;
  browser.session.navigate('http://www.xdsearch.fr/?q=depuis-explorer');
  browser.open();
  assert.equal(browser.instance, openInstance);
  assert.equal(browser.session.address, 'http://www.xdsearch.fr/?q=depuis-explorer');
  assert.equal(spawnCount, 1);
});

test('Internet Adventurer layout keeps its toolbars fixed while the page area scrolls and grows', () => {
  const css = readFileSync(new URL('../src/styles-browser.css', import.meta.url), 'utf8');
  const toolbar = css.match(/\.browser-toolbar\s*\{([^}]+)\}/)?.[1] ?? '';
  const page = css.match(/\.browser-page\s*\{([^}]+)\}/)?.[1] ?? '';
  const initial = css.match(/\.desktop \.popup\.internet-adventurer\s*\{([^}]+)\}/)?.[1] ?? '';

  assert.match(toolbar, /flex-shrink:\s*0/);
  assert.match(page, /flex:\s*1/);
  assert.match(page, /min-height:\s*0/);
  assert.match(page, /overflow:\s*auto/);
  assert.match(initial, /width:\s*min\(740px, 100%\)/);
  assert.match(initial, /height:\s*470px/);
  assert.doesNotMatch(initial, /resize:\s*both/);
});

test('URLs normalize aliases and paths locally and reject host files, scripts, credentials and ports', () => {
  for (const input of [
    'http://www.xdsearch.fr',
    'www.xdsearch.fr',
    'xdsearch.fr',
    ' HTTPS://XDSEARCH.FR/#fragment ',
  ])
    assert.equal(normalizeUrl(input), HOME_URL);
  assert.equal(
    normalizeUrl('skypage.fr/pixelgirl?q=bonjour'),
    'http://www.skypage.fr/pixelgirl?q=bonjour',
  );
  for (const input of [
    'javascript:alert(1)',
    'file:///C:/Users/test',
    'data:text/html,hello',
    'http://u:p@xdsearch.fr',
    'http://xdsearch.fr:8080',
    '',
    null,
  ])
    assert.equal(normalizeUrl(input), null);
});
test('registry resolves only implemented available pages and differentiates domain errors, 404 and explicit timeout', () => {
  assert.equal(localPages.resolve('xdsearch.fr/?q=internet', {}).page.title, 'XD Search');
  assert.equal(localPages.resolve('xdsearch.fr/missing', {}).error, 'not-found');
  for (const domain of ['unknown.fr'])
    assert.equal(localPages.resolve(domain, {}).error, 'connection');
  const registry = new PageRegistry();
  registry.register({
    url: 'flashzone.fr/jeux/test',
    title: 'Test',
    render() {},
    available: (data) => data.unlocked,
  });
  registry.register({ url: 'flashzone.fr/lent', title: 'Lent', render() {}, error: 'timeout' });
  assert.equal(registry.resolve('flashzone.fr/jeux/test', {}).error, 'not-found');
  assert.equal(registry.resolve('flashzone.fr/jeux/test', { unlocked: true }).page.title, 'Test');
  assert.equal(registry.resolve('flashzone.fr/lent', {}).error, 'timeout');
});
test('search matches multiple terms, casing and accents and excludes nonexistent/unavailable/error pages', () => {
  const registry = new PageRegistry();
  const render = () => {};
  registry.register({
    url: 'flashzone.fr/',
    title: 'FlashZone',
    description: 'Jeux Flash gratuits',
    keywords: ['arcade'],
    render,
  });
  registry.register({ url: 'wiki.fr/', title: 'Jeux de société', render });
  registry.register({
    url: 'wiki.fr/cache',
    title: 'Jeux flash gratuits',
    render,
    available: () => false,
  });
  registry.register({
    url: 'wiki.fr/lent',
    title: 'Jeux flash gratuits',
    render,
    error: 'timeout',
  });
  assert.deepEqual(
    registry.search('JEUX flash', {}).map((page) => page.title),
    ['FlashZone', 'Jeux de société'],
  );
  assert.equal(registry.search('societe', {})[0].title, 'Jeux de société');
  assert.ok(localPages.search('jeux flash', {}).some((page) => page.url.includes('flashzone.fr')));
});

test('site directory derives only available implemented homepages and picks up future registrations', (t) => {
  assert.deepEqual(
    localPages.sites({}).map((page) => page.url),
    [
      HOME_URL,
      'http://www.skypage.fr/',
      'http://www.forumjeu.fr/',
      'http://www.flashzone.fr/',
      'http://www.videotube.fr/',
      'http://www.wiki.fr/',
      'http://www.hoplahotel.fr/',
    ],
  );
  const registry = new PageRegistry();
  const render = () => {};
  registry.register({ url: 'example.fr/blog', title: 'Blog', render });
  assert.equal(registry.sites({}).length, 0);
  const remove = registry.register({
    url: 'example.fr',
    title: 'Example',
    description: '<img onerror=alert(1)>',
    render,
  });
  registry.register({ url: 'example.fr/other', title: 'Other', render });
  registry.register({ url: 'example.fr/?preview=1', title: 'Preview', render });
  registry.register({
    url: 'locked.fr',
    title: 'Locked',
    available: (data) => data.unlocked,
    render,
  });
  registry.register({ url: 'broken.fr', title: 'Broken', error: 'timeout', render });
  assert.deepEqual(
    registry.sites({}).map((page) => page.title),
    ['Example'],
  );
  assert.equal(registry.sites({ unlocked: true }).length, 2);
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        children: [],
        dataset: {},
        classList: { toggle() {} },
        setAttribute() {},
        addEventListener() {},
        append(...nodes) {
          this.children.push(...nodes);
        },
        set innerHTML(value) {
          throw new Error('Unsafe HTML');
        },
      };
    },
  };
  t.after(() => {
    globalThis.document = previous;
  });
  const tree = renderSearch({ url: new URL(HOME_URL), registry, data: {}, navigate() {} });
  const directory = tree.children.find((node) => node.className === 'xd-sites');
  assert.equal(directory.children[0].textContent, 'Sites Web');
  const items = directory.children[1].children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children[0].dataset.browserLink, 'http://www.example.fr/');
  assert.equal(items[0].children[0].href, '#');
  assert.equal(items[0].children[1].textContent, '<img onerror=alert(1)>');
  remove();
  assert.equal(registry.sites({}).length, 0);
});
test('tabs keep independent histories, truncate forward history, restore from saves and reset with New Game', () => {
  const { progression, storage, session } = fixture();
  const narrative = JSON.stringify([progression.data.dialogues, progression.data.choices]);
  const first = session.active;
  session.navigate('unknown.fr');
  session.navigate('xdsearch.fr/missing');
  session.move(-1);
  assert.equal(session.address, 'http://www.unknown.fr/');
  const second = session.add();
  session.navigate('xdsearch.fr/?q=internet');
  session.select(first);
  assert.equal(session.address, 'http://www.unknown.fr/');
  session.move(1);
  assert.equal(session.address, 'http://www.xdsearch.fr/missing');
  session.move(-1);
  session.navigate('xdsearch.fr/?q=nouveau');
  assert.equal(session.move(1), false);
  const restored = new BrowserSession(new Progression(story, storage));
  assert.deepEqual(restored.tabs, session.tabs);
  assert.equal(restored.active, first);
  restored.close(first);
  assert.equal(restored.active, second.id);
  assert.equal(restored.address, 'http://www.xdsearch.fr/?q=internet');
  restored.close(second.id);
  assert.equal(restored.tabs.length, 0);
  const reopened = new BrowserSession(new Progression(story, storage));
  assert.equal(reopened.address, HOME_URL);
  assert.equal(JSON.stringify([progression.data.dialogues, progression.data.choices]), narrative);
  progression.newGame();
  session.restore();
  assert.equal(session.tabs.length, 1);
  assert.equal(session.address, HOME_URL);
});
test('corrupt browser fields fall back locally without invalidating narrative data and history is bounded', () => {
  const { progression, session } = fixture();
  for (const saved of [
    null,
    { version: 1, tabs: [{}] },
    { version: 1, tabs: [{ id: 'x', title: 'x', history: [], cursor: 0 }], active: 'x' },
  ]) {
    progression.data.browser = saved;
    session.restore();
    assert.equal(session.address, HOME_URL);
  }
  for (let i = 0; i < 110; i++) session.navigate(`xdsearch.fr/?q=${i}`);
  assert.equal(session.tab.history.length, 100);
  assert.equal(session.tab.cursor, 99);
});

test('browser restoration drops only malformed tabs and selects a surviving tab when active is invalid', () => {
  const { progression, session } = fixture();
  progression.data.browser = {
    version: 1,
    active: 'bad',
    tabs: [
      { id: 'bad', title: 'bad', history: [null], cursor: 0 },
      { id: 'first', title: 'First', history: ['http://www.xdsearch.fr/'], cursor: 0 },
      { id: 'second', title: 'Second', history: ['http://www.xdsearch.fr/missing'], cursor: 0 },
    ],
  };
  session.restore();
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['first', 'second']);
  assert.equal(session.active, 'first');
  assert.equal(session.address, 'http://www.xdsearch.fr/');
});
test('XD Search and error pages use local links and text for user input without unsafe HTML', (t) => {
  const previous = globalThis.document;
  const create = () => ({
    children: [],
    dataset: {},
    handlers: {},
    classList: { toggle() {} },
    setAttribute() {},
    append(...children) {
      this.children.push(...children);
    },
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    },
  });
  globalThis.document = { createElement: create };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const query = '<img src=x onerror=alert(1)>';
  let navigated;
  const registry = new PageRegistry();
  const page = renderSearch({
    url: new URL(`${HOME_URL}?q=${encodeURIComponent(query)}`),
    registry,
    data: {},
    navigate: (url) => (navigated = url),
  });
  assert.equal(page.children[2].textContent, `Aucun résultat trouvé pour « ${query} ».`);
  const form = page.children[1];
  form.children[0].value = 'recherche';
  form.handlers.submit({ preventDefault() {} });
  assert.equal(navigated, `${HOME_URL}?q=recherche`);
  const results = renderSearch({
    url: new URL(`${HOME_URL}?q=internet`),
    registry: localPages,
    data: {},
    navigate() {},
  });
  assert.equal(results.children[2].children[0].href, '#');
  assert.equal(results.children[2].children[0].dataset.browserLink, HOME_URL);
  assert.match(renderError('timeout').children[0].textContent, /délai/);
});
