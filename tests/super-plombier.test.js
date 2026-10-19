import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { localPages } from '../src/browser/registry.js';
import { flashCatalog } from '../src/browser/sites/flashzone/index.js';
import {
  PLUMBER_GOAL_X,
  PLUMBER_HEIGHT,
  PLUMBER_GROUND,
  PLUMBER_LEVEL,
  PLUMBER_MAX_SPEED,
  PLUMBER_MINIMUM_TIME_MS,
  PLUMBER_START_X,
  TURBO_RECORD_MS,
  SuperPlombierRound,
  formatPlumberTime,
} from '../src/browser/sites/flashzone/super-plombier-round.js';
import { Progression } from '../src/story/progression.js';
import { DialogueSession, validateDialogue } from '../src/story/dialogue.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConversationWindow } from '../src/ui/conversation.js';
import { visibleContacts } from '../src/ui/contacts.js';
import { renderSuperPlombierFlash } from '../src/browser/sites/flashzone/super-plombier-flash.js';
import { installDevelopmentVictoryShortcut } from '../src/dev/finish-shortcut.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const contacts = read('../src/config/contacts.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((filename) => filename.endsWith('.json'))
    .map((filename) => {
      const dialogue = read(`../src/dialogues/${filename}`);
      return [dialogue.id, dialogue];
    }),
);
const scene3 = definitions['turbo-smiley-catcher'];
const invitation = definitions['turbo-flashzone-invitation'];
const game = flashCatalog.games.find((entry) => entry.id === 'super-plombier-flash');
const GAME_URL = 'http://www.flashzone.fr/jeux/super-plombier-flash';

function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return { storage, progression: new Progression(story, storage) };
}

function finishScene3(progression, choiceId) {
  const session = new DialogueSession(scene3, progression);
  assert.equal(session.nextMessage().text, 'mdrrrr noob');
  session.deliver();
  const choice = session.choices.find((entry) => entry.id === choiceId);
  assert.ok(choice);
  session.choose(choice.id);
  while (!session.state.finished) {
    if (session.nextMessage()) session.deliver();
    else if (session.choices.length) session.choose(session.choices[0].id);
    else if (!session.advance()) assert.equal(session.state.finished, true);
  }
  return session;
}

test('Turb0 scene 3 completion connects Luna after a saved three-second delay on all branches', () => {
  for (const choiceId of ['noob', 'screen', 'leave-me-alone']) {
    const { progression, storage } = fixture();
    const session = finishScene3(progression, choiceId);
    assert.equal(session.state.finished, true);
    const lunaBefore = visibleContacts(
      definitions,
      progression.data.unlockedConversations,
      contacts,
      progression.data.contactConnections,
      progression.data.contactProfiles,
      progression.data.flags,
    ).find((contact) => contact.id === 'luna');
    assert.equal(lunaBefore.online, false);
    assert.equal(lunaBefore.status, 'Hors ligne');

    const connected = [];
    const events = new DialogueEvents(progression, definitions, (id) => connected.push(id));
    const finishedAt = 10_000;
    events.update(finishedAt);
    assert.deepEqual(progression.data.contactConnections.luna, {
      status: 'pending',
      dueAt: finishedAt + 3000,
    });
    events.update(finishedAt + 2999);
    assert.deepEqual(connected, []);
    events.update(finishedAt + 3000);
    events.update(finishedAt + 9000);
    assert.deepEqual(connected, ['luna']);

    const lunaAfter = visibleContacts(
      definitions,
      progression.data.unlockedConversations,
      contacts,
      progression.data.contactConnections,
      progression.data.contactProfiles,
      progression.data.flags,
    ).find((contact) => contact.id === 'luna');
    assert.equal(lunaAfter.online, true);
    assert.equal(lunaAfter.status, 'En ligne');
    const restored = new Progression(story, storage);
    new DialogueEvents(restored, definitions, (id) => connected.push(id)).update(
      finishedAt + 20_000,
    );
    assert.equal(restored.data.contactConnections.luna.status, 'online');
    assert.deepEqual(connected, ['luna']);
  }
});

test('invitation is a saved Turbo conversation event with a clickable local FlashZone route', () => {
  validateDialogue(invitation);
  assert.equal(invitation.contact.id, 'turbo');
  assert.deepEqual(
    invitation.nodes.invitation.messages.slice(0, 4).map((message) => message.text),
    [
      "attends j'ai mieux",
      'tu connais super plombier flash ?',
      "mon record c'est 12,43 secondes mdr",
      'essaie de faire mieux',
    ],
  );
  const link = invitation.nodes.invitation.messages.at(-1);
  assert.equal(link.type, 'link');
  assert.equal(link.url, GAME_URL);
  assert.equal(localPages.resolve(link.url, {}).error, 'not-found');
  assert.equal(
    localPages.resolve(link.url, { flags: { superPlombierFlashUnlocked: true } }).page.title,
    'Super Plombier Flash — FlashZone',
  );

  const { progression } = fixture();
  const events = [scene3, invitation];
  const thread = new ConversationThread('turbo', progression, () => events);
  thread.schedule(invitation, 1000);
  const state = progression.data.dialogues[invitation.id];
  while (!state.finished) {
    if (new DialogueSession(invitation, progression).nextMessage()) {
      state.receiveDueAt = 0;
      thread.receive(100_000);
    } else new DialogueSession(invitation, progression).advance();
  }
  thread.sync();
  const savedLink = progression.data.dialogues[invitation.id].transcript.at(-1);
  assert.equal(savedLink.type, 'link');
  assert.equal(savedLink.url, GAME_URL);
  assert.equal(thread.state.history.at(-1).url, GAME_URL);
});

test('Turb0 third friends response asks about PixelGirl without changing the other branches', () => {
  const turbo = definitions['turbo-super-plombier'];
  const friends = turbo.nodes.friends;
  assert.deepEqual(friends.choices.map(({ text }) => text), [
    'vous vous connaissez depuis longtemps ?',
    'elle est marrante en vrai',
    'pixelgirl elle est toujours comme ça ?',
  ]);
  assert.deepEqual(
    turbo.nodes['luna-reply'].messages.map(({ text }) => text),
    ['TOUJOURS ptdrrr', 'même quand elle dort jcrois xD'],
  );
  assert.equal(turbo.nodes['friends-forum-reply'].messages[0].text, 'ouais on s\'est connus sur un forum');
  assert.equal(turbo.nodes['pixelgirl-funny-reply'].messages[0].text, 'ouais grave');
});

test('French dialogue characters survive JSON save and reload', () => {
  const { progression, storage } = fixture();
  const turbo = definitions['turbo-super-plombier'];
  progression.data.dialogues[turbo.id] = {
    revision: turbo.revision,
    node: 'friends',
    cursor: turbo.nodes.friends.messages.length,
    transcript: [],
    finished: false,
  };
  const session = new DialogueSession(turbo, progression);
  session.choose('luna-personality');
  while (session.nextMessage()) session.deliver();
  assert.deepEqual(
    session.state.transcript.map((message) => message.text),
    [
      'pixelgirl elle est toujours comme ça ?',
      'TOUJOURS ptdrrr',
      'même quand elle dort jcrois xD',
    ],
  );
  const restored = new Progression(story, storage);
  assert.deepEqual(
    restored.data.dialogues[turbo.id].transcript.map((message) => message.text),
    [
      'pixelgirl elle est toujours comme ça ?',
      'TOUJOURS ptdrrr',
      'même quand elle dort jcrois xD',
    ],
  );
});

test('Messenger renders the invitation URL as an action routed to the browser', (t) => {
  const previous = globalThis.document;
  const makeElement = (tag) => ({
    tag,
    children: [],
    dataset: {},
    handlers: {},
    append(...children) {
      this.children.push(...children);
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
  });
  globalThis.document = { createElement: makeElement };
  t.after(() => {
    globalThis.document = previous;
  });
  let opened = '';
  const view = {
    dialogue: { contact: { nickname: 'Turb0' } },
    flow: { append(row) { this.row = row; } },
    onLink: (url) => (opened = url),
    scrollLatest() {},
  };
  const row = ConversationWindow.prototype.appendMessage.call(view, {
    speaker: 'contact',
    type: 'link',
    text: GAME_URL,
    url: GAME_URL,
  });
  const anchor = row.children[1];
  let prevented = false;
  anchor.handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(opened, GAME_URL);
});

test('Super Plombier Flash remains hidden and inaccessible until Turb0 sends its link', () => {
  assert.ok(game);
  assert.equal(game.title, 'Super Plombier Flash');
  assert.equal(game.category, 'Plateforme');
  assert.equal(localPages.resolve(GAME_URL, {}).error, 'not-found');
  assert.ok(!localPages.search('super plombier flash', {}).some((page) => page.url === GAME_URL));
  const unlocked = { flags: { superPlombierFlashUnlocked: true } };
  assert.equal(localPages.resolve(GAME_URL, unlocked).page.preserveOnTabSwitch, true);
  assert.ok(localPages.search('super plombier flash', unlocked).some((page) => page.url === GAME_URL));
});

test('fixed level geometry makes Turb0’s 12.43-second record physically unreachable', () => {
  assert.ok(PLUMBER_LEVEL.minimumHorizontalDistance > 0);
  assert.ok(PLUMBER_MAX_SPEED > 0);
  assert.ok(PLUMBER_GOAL_X > PLUMBER_START_X);
  assert.ok(PLUMBER_MINIMUM_TIME_MS > TURBO_RECORD_MS);
  assert.ok(
    PLUMBER_LEVEL.minimumHorizontalDistance / PLUMBER_MAX_SPEED > TURBO_RECORD_MS / 1000,
  );
  assert.equal(formatPlumberTime(72_387), '01:12,38');
});

test('platform movement, jump, coins, enemy stomps and automatic death reset work', () => {
  const round = new SuperPlombierRound().begin(1000);
  for (let now = 1016; now <= 2016; now += 16) round.tick(now, { right: true });
  assert.ok(round.player.x > PLUMBER_START_X);
  assert.ok(round.player.vx <= PLUMBER_MAX_SPEED);

  assert.ok(round.jump());
  const jumpY = round.player.y;
  for (let now = 2032; now <= 2112; now += 16) round.tick(now);
  assert.ok(round.player.y < jumpY);
  for (let now = 2128; now <= 2900; now += 16) round.tick(now);
  assert.equal(round.player.grounded, true);

  const coin = { id: 999, x: round.player.x + 12, y: round.player.y + 18, collected: false };
  round.coins = [coin];
  round.tick(2916);
  assert.equal(coin.collected, true);

  const enemy = round.enemies[0];
  enemy.x = round.player.x;
  enemy.minX = enemy.x;
  enemy.maxX = enemy.x + enemy.w;
  enemy.speed = 0;
  round.player.y = enemy.y - round.player.h - 2;
  round.player.vy = 200;
  round.player.grounded = false;
  round.tick(2932);
  assert.equal(enemy.alive, false);

  enemy.alive = true;
  enemy.x = round.player.x + round.player.w - 1;
  enemy.minX = enemy.x;
  enemy.maxX = enemy.x + enemy.w;
  round.player.vx = 0;
  round.player.y = PLUMBER_GROUND - round.player.h;
  round.player.vy = 0;
  round.player.grounded = true;
  round.coins[0].collected = true;
  round.tick(2948);
  assert.equal(round.deaths, 1);
  assert.equal(round.player.x, PLUMBER_START_X);
  assert.equal(round.coins[0].collected, false);
  assert.equal(round.elapsed, 0);
  assert.equal(round.active, true);
});

test('crossing the finish stops the real-time clock and replay starts from zero', () => {
  const round = new SuperPlombierRound().begin(0);
  for (const enemy of round.enemies) enemy.alive = false;
  round.player.x = PLUMBER_GOAL_X - round.player.w - 1;
  round.tick(25_000, { right: true });
  assert.equal(round.won, true);
  assert.equal(round.active, false);
  assert.equal(round.elapsed, 25_000);
  round.begin(30_000);
  assert.equal(round.elapsed, 0);
  assert.equal(round.won, false);
  assert.equal(round.player.x, PLUMBER_START_X);
});

test('a fixed route can be completed with timed jumps without deaths', () => {
  const round = new SuperPlombierRound().begin(0);
  let deaths = 0;
  for (let now = 16; now < 120_000 && round.active; now += 16) {
    const x = round.player.x;
    const hazards = [
      ...PLUMBER_LEVEL.gaps.map(([start]) => ({ x: start, jumpAt: 55 })),
      ...PLUMBER_LEVEL.pipes.map((pipe) => ({ x: pipe.x, jumpAt: 118 })),
      ...round.enemies.filter((enemy) => enemy.alive).map((enemy) => ({ x: enemy.x, jumpAt: 118 })),
    ]
      .filter((hazard) => hazard.x > x + 8)
      .sort((a, b) => a.x - b.x);
    if (hazards[0] && round.player.grounded && hazards[0].x - x < hazards[0].jumpAt)
      round.jump();
    const previousDeaths = round.deaths;
    round.tick(now, { right: true });
    deaths += round.deaths - previousDeaths;
  }
  assert.equal(round.won, true);
  assert.equal(deaths, 0);
  assert.ok(round.elapsed > 40_000);
  assert.ok(round.elapsed < 60_000);
  assert.ok(round.elapsed > TURBO_RECORD_MS);
});

test('FlashZone game starts from its button, captures movement keys and removes listeners', (t) => {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    Audio: globalThis.Audio,
  };
  const audioInstances = [];
  globalThis.Audio = class {
    constructor(url) {
      this.src = url;
      this.currentTime = 5;
      this.loop = false;
      this.volume = 1;
      this.playCount = 0;
      this.pauseCount = 0;
      audioInstances.push(this);
    }
    play() { this.playCount++; return Promise.resolve(); }
    pause() { this.pauseCount++; }
    removeAttribute(name) { this.removedAttribute = name; }
    load() { this.loaded = true; }
  };
  const frames = new Map();
  const documentListeners = new Map();
  let serial = 0,
    activeElement,
    cleanup;
  const fillColors = [];
  const context = { fillRect() { fillColors.push(this.fillStyle); } };
  globalThis.document = {
    hidden: false,
    addEventListener: (type, handler) => documentListeners.set(type, handler),
    removeEventListener: (type) => documentListeners.delete(type),
    createElement(tag) {
      return {
        tag,
        children: [],
        style: {},
        dataset: {},
        handlers: {},
        textContent: '',
        isConnected: true,
        append(...children) {
          this.children.push(...children);
        },
        addEventListener(type, handler) {
          this.handlers[type] = handler;
        },
        removeEventListener(type) {
          delete this.handlers[type];
        },
        setAttribute() {},
        focus() {
          activeElement = this;
        },
        getContext() {
          return context;
        },
      };
    },
  };
  globalThis.requestAnimationFrame = (handler) => {
    frames.set(++serial, handler);
    return serial;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    if (previous.Audio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previous.Audio;
  });
  const { progression, storage } = fixture();
  let narrativeVictories = 0;
  const reactionNow = 10_000;
  const turboThread = new ConversationThread('turbo', progression, () => [
    definitions['turbo-super-plombier'],
  ]);
  let narrative;
  const dialogueEvents = new DialogueEvents(
    progression,
    definitions,
    (id) => narrative.onContactConnected(id),
  );
  narrative = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents,
    getContact: (id) => id === 'turbo' ? { id: 'turbo', available: true, online: true } : null,
    prepareContact: () => ({ thread: turboThread }),
    getTurboThread: () => turboThread,
    showConnectionNotification: () => {},
    now: () => reactionNow,
  });
  let resume;
  const root = renderSuperPlombierFlash(
    {
      progression,
      onDispose: (fn) => (cleanup = fn),
      onResume: (callback) => (resume = callback),
      onVictory: () => {
        narrativeVictories++;
        narrative.onSuperPlombierVictory();
      },
    },
    game,
  );
  const walk = (entry) => [entry, ...entry.children.flatMap(walk)];
  const nodes = walk(root);
  const visibleText = nodes.map((entry) => entry.textContent).join(' ');
  assert.doesNotMatch(visibleText, /record.*turb0|turb0.*record/i);
  const play = nodes.find((entry) => entry.className === 'plumber-play');
  const canvas = nodes.find((entry) => entry.className === 'plumber-canvas');
  play.handlers.click();
  assert.equal(audioInstances.length, 1);
  const music = audioInstances[0];
  assert.match(music.src, /moodmode-retro-game-arcade-236133\.mp3$/);
  assert.equal(music.loop, true);
  assert.equal(music.volume, 0.35);
  assert.equal(music.playCount, 1);
  assert.equal(progression.data.flags.superPlombierFirstAttempt, true);
  assert.equal(root.running, true);
  assert.equal(activeElement, canvas);
  assert.equal(frames.size, 1);
  cleanup('pause');
  assert.equal(music.pauseCount, 1);
  resume();
  assert.equal(music.playCount, 2);
  assert.ok(fillColors.includes('#c72c2c'), 'player outfit is red');
  assert.ok(fillColors.includes('#2766c5'), 'player outfit keeps a blue detail');
  let prevented = false;
  canvas.handlers.keydown({
    code: 'ArrowRight',
    repeat: false,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(canvas.handlers.keydown !== undefined, true);
  let keydown;
  const removeShortcut = installDevelopmentVictoryShortcut(
    { addEventListener: (_type, callback) => (keydown = callback), removeEventListener() {} },
    () => (root.running ? root : null),
  );
  let preventedShortcut = 0;
  const developerFinish = {
    key: 'D',
    ctrlKey: true,
    shiftKey: true,
    preventDefault() { preventedShortcut++; },
  };
  keydown(developerFinish);
  assert.equal(root.finished, true);
  assert.equal(root.running, false);
  assert.equal(music.currentTime, 0);
  assert.equal(music.pauseCount, 2);
  assert.equal(nodes.find((entry) => entry.className === 'plumber-result').hidden, false);
  assert.equal(nodes.find((entry) => entry.tag === 'strong' && entry.textContent.includes('Victoire développeur')).textContent,
    'Victoire développeur — temps non enregistré');
  assert.equal(progression.data.flags.superPlombierFirstCompletion, true);
  assert.deepEqual(progression.data.results, {});
  assert.equal(narrativeVictories, 1);
  assert.equal(progression.data.pendingMiniGameReaction.dueAt, reactionNow + 2000);
  narrative.update(reactionNow);
  const restoredProgression = new Progression(story, storage);
  const restoredTurboThread = new ConversationThread('turbo', restoredProgression, () => [
    definitions['turbo-super-plombier'],
  ]);
  assert.deepEqual(restoredTurboThread.receive(reactionNow + 1999), []);
  const received = restoredTurboThread.receive(reactionNow + 2000);
  assert.equal(received.length, 1);
  assert.equal(restoredTurboThread.state.history[0].text, 'alors noob ta fini ? xD');
  assert.equal(restoredProgression.data.pendingMiniGameReaction, null);
  assert.deepEqual(restoredTurboThread.receive(reactionNow + 2000), []);
  keydown(developerFinish);
  assert.equal(narrativeVictories, 1);
  assert.equal(preventedShortcut, 1);
  removeShortcut();
  play.handlers.click();
  assert.equal(audioInstances.length, 1);
  assert.equal(music.currentTime, 0);
  assert.equal(music.playCount, 3);
  const restartButton = nodes.find((entry) => entry.className === 'plumber-restart');
  const originalTick = SuperPlombierRound.prototype.tick;
  SuperPlombierRound.prototype.tick = function (time, controls) {
    this.player.y = PLUMBER_HEIGHT + 81;
    return originalTick.call(this, time, controls);
  };
  t.after(() => { SuperPlombierRound.prototype.tick = originalTick; });
  let observedDeaths = 0;
  let now = performance.now();
  for (let step = 0; step < 5 && observedDeaths < 5; step++) {
    const [frameId, callback] = frames.entries().next().value ?? [];
    assert.equal(typeof callback, 'function', 'the active game keeps scheduling frames');
    const playsBefore = music.playCount;
    music.currentTime = 12;
    frames.delete(frameId);
    callback(now += 16);
    if (music.playCount > playsBefore) {
      observedDeaths++;
      assert.equal(music.currentTime, 0, 'each death interrupts and restarts the same music element');
    }
  }
  assert.equal(observedDeaths, 5, 'five consecutive deaths restart playback');
  SuperPlombierRound.prototype.tick = originalTick;
  assert.equal(audioInstances.length, 1, 'deaths never create overlapping audio elements');
  music.currentTime = 18;
  restartButton.handlers.click();
  assert.equal(music.currentTime, 0, 'the Recommencer button also returns music to the beginning');
  assert.equal(audioInstances.length, 1);
  cleanup();
  assert.equal(music.removedAttribute, 'src');
  assert.equal(music.loaded, true);
  assert.equal(frames.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(canvas.handlers.keydown, undefined);
  let disposeReopened;
  const reopened = renderSuperPlombierFlash({
    progression,
    onDispose: (fn) => (disposeReopened = fn),
  }, game);
  const reopenedPlay = walk(reopened).find((entry) => entry.className === 'plumber-play');
  reopenedPlay.handlers.click();
  assert.equal(audioInstances.length, 2, 'reopening creates a fresh, single player instance');
  assert.equal(audioInstances[1].currentTime, 0);
  disposeReopened();
  assert.equal(audioInstances[1].removedAttribute, 'src');
  assert.equal(frames.size, 0);
  assert.equal(documentListeners.size, 0);
});
