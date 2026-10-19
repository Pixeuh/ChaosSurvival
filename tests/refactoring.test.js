import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFileActivation } from '../src/utils/activation.js';
import { appendMessageText } from '../src/ui/message-text.js';
import { MiniGameLauncher } from '../src/ui/minigame-launcher.js';
import { registerMiniGame } from '../src/ui/minigame-registry.js';
import { Progression } from '../src/story/progression.js';

const story = {
  version: 1,
  start: 'game',
  sequences: [{ id: 'game', type: 'minigame', game: 'test-game', next: null }],
};

test('shared activation preserves double-click and Enter without treating a click or another key as opening', () => {
  const handlers = {};
  let opens = 0,
    prevented = 0;
  bindFileActivation(
    {
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
    },
    () => opens++,
  );
  assert.equal(handlers.click, undefined);
  handlers.keydown({
    key: 'Space',
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(opens, 0);
  handlers.keydown({
    key: 'Enter',
    preventDefault() {
      prevented++;
    },
  });
  handlers.dblclick();
  assert.equal(opens, 2);
  assert.equal(prevented, 1);
});

test('extracted Messenger formatting preserves emoticons and renders HTML-looking dialogue as text', (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    baseURI: 'https://example.test/',
    createTextNode(text) {
      return { textContent: text };
    },
    createElement(tagName) {
      return { tagName: tagName.toUpperCase(), setAttribute() {} };
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const children = [];
  appendMessageText(
    {
      append(node) {
        children.push(node);
      },
    },
    'salut <3 <img src=x> :D :3 :) :| >:) :( ;) :P',
  );
  assert.equal(
    children.map((node) => node.alt ?? node.textContent).join(''),
    'salut \u2665 <img src=x> :D :3 :) :| >:) :( 😉 😛',
  );
  assert.equal(children.filter((node) => node.className?.includes('msn-emoticon')).length, 7);
  assert.deepEqual(children.filter((node) => node.tagName === 'IMG').map((node) => node.src), [
    'https://example.test/emoticons/msn-smile.svg',
    'https://example.test/emoticons/msn-smile.svg',
    'https://example.test/emoticons/msn-neutral.svg',
    'https://example.test/emoticons/msn-devil.svg',
  ]);
  assert.ok(children.some((node) => !node.className && node.textContent.includes(':3')));
});

test('xD variants remain literal in private, group, player and restored Messenger messages', (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    createTextNode(text) { return { textContent: text }; },
    createElement(tagName) { return { tagName: tagName.toUpperCase(), setAttribute() {} }; },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const source = [
    { speaker: 'contact', conversation: 'pixelgirl', text: 'xD XD xd Xd' },
    { speaker: 'player', conversation: 'pixelgirl', text: 'xDD XDDDD xDDD' },
    { speaker: 'contact', conversation: 'plumber-group', text: 'Turb0: xD; PixelGirl: XDDDD' },
  ];
  const restored = JSON.parse(JSON.stringify(source));
  for (const message of restored) {
    const nodes = [];
    appendMessageText({ append: (node) => nodes.push(node) }, message.text);
    assert.equal(nodes.map((node) => node.textContent).join(''), message.text);
    assert.equal(nodes.some((node) => node.className?.includes('msn-emoticon')), false);
  }
});

test('additional engines reuse file gating and completion without duplicating progression or instances', () => {
  let factories = 0,
    opens = 0,
    windowOpened = 0,
    before = 0;
  registerMiniGame('test-engine', (definition, manager, sounds, complete) => {
    factories++;
    return {
      definition,
      open() {
        opens++;
        this.element = { isConnected: true };
      },
      finish() {
        complete({ score: 42 });
      },
    };
  });
  const progression = new Progression(story);
  progression.begin();
  const file = progression.receiveFile(
    { id: 'file', name: 'GAME.exe', launch: { game: 'test-game' } },
    'contact',
    'offer',
  );
  const launcher = new MiniGameLauncher(
    { 'test-game': { id: 'test-game', engine: 'test-engine' } },
    progression,
    {},
    { unlock() {} },
    () => before++,
    undefined,
    undefined,
    undefined,
    undefined,
    (game) => {
      windowOpened++;
      assert.equal(game.definition.id, 'test-game');
    },
  );
  assert.equal(launcher.open(file), null);
  assert.equal(before, 0);
  progression.finishTransfer(file.key);
  const first = launcher.open(file);
  assert.equal(launcher.open(file), first);
  assert.equal(factories, 1);
  assert.equal(opens, 2);
  assert.equal(windowOpened, 2, 'the window integration callback runs on each activation');
  first.finish();
  const saved = JSON.stringify(progression.data);
  first.finish();
  assert.equal(JSON.stringify(progression.data), saved);
  first.element.isConnected = false;
  const replay = launcher.open(file);
  assert.notEqual(replay, first);
  assert.equal(windowOpened, 3, 'a reopened game is offered for taskbar registration');
  replay.finish();
  assert.equal(JSON.stringify(progression.data), saved);
  launcher.reset();
  assert.equal(launcher.active, null);
});

test('unavailable engines report a meaningful error without inventing a completed game', () => {
  const progression = new Progression(story);
  const file = progression.receiveFile(
    { id: 'file', name: 'GAME.exe', launch: { game: 'missing' } },
    'contact',
    'offer',
  );
  progression.finishTransfer(file.key);
  const launcher = new MiniGameLauncher({}, progression, {}, {});
  assert.throws(() => launcher.open(file), /mini-jeu est indisponible/);
  assert.equal(launcher.active, null);
  assert.equal(progression.data.completed.length, 0);
});
