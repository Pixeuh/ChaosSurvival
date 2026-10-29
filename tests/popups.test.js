import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { popupContent, WINDOW_TYPES } from '../src/config/popups.js';
import { createPopupContent } from '../src/ui/popup-content.js';
import { compileChart, Timeline } from '../src/game/timeline.js';
import { GameState } from '../src/game/state.js';
import { createHash } from 'node:crypto';
import { selectMsnPopupIndex } from '../src/game/msn-popup-schedule.js';

test('every popup variant renders its content and offers a way to dismiss non-MSN windows', () => {
  for (const type of WINDOW_TYPES) {
    popupContent[type].forEach((_variant, index, variants) => {
      const content = createPopupContent(type, () => (index + 0.5) / variants.length);
      assert.ok(content.title.length > 0, type);
      assert.ok(content.iconName.length > 0, type);
      assert.ok(content.body.length > 0, type);
      assert.ok(!content.body.includes('undefined'), `${type}: ${index}`);
      if (type !== 'msn') assert.match(content.body, /data-dismiss/, type);
    });
  }
  assert.throws(() => createPopupContent('unknown'), /Type de fenêtre inconnu/);
  assert.throws(() => createPopupContent('constructor'), /Type de fenêtre inconnu/);
});

test('MSN messages display hearts and emoticons as text rather than HTML', () => {
  const conversation = createPopupContent('msn', () => 2.5 / popupContent.msn.length);
  assert.match(conversation.body, /&lt;3/);
  assert.equal((conversation.body.match(/dit :/g) ?? []).length, 3);
});

test('keeps all original MSN variants unchanged and adds the three specified contacts', () => {
  assert.equal(popupContent.msn.length, 21);
  assert.equal(createHash('sha256').update(JSON.stringify(popupContent.msn.slice(0, 18))).digest('hex'),
    '300cff70cca4c8e47288bbef805b1ce20bd6ee95b912dcc41a03901e3b8a6e1e');
  assert.deepEqual(popupContent.msn.slice(18), [
    { name: 'oO_Cerise_Oo', status: 'En ligne · jamais dehors :p', messages: ["t'as déjà rêvé que tu sortais de chez toi ?", "moi ça m'arrive tout le temps xD", 'mais je sais même plus à quoi ressemble ma rue lol'] },
    { name: 'just_a_boy_92', status: 'Occupé · cherche la sortie', messages: ["j'ai essayé de partir hier", "mais j'arrive toujours au même endroit", 'tu sais comment on fait toi ?'] },
    { name: 'xX_Mel0dy_Xx', status: 'En ligne · nostalgie ♡', messages: ['tu te souviens de notre sortie samedi ?', "j'ai retrouvé les photos !!", "mais pourquoi y'a personne dessus ? o_O"] },
  ]);
});

test('new MSN hints are scheduled outside the first quarter and guaranteed in their intended quarters', () => {
  const counts = [0, 0, 0, 0];
  assert.ok(selectMsnPopupIndex(1, 100, counts, () => 0) < 18);
  assert.equal(selectMsnPopupIndex(30, 100, counts), 18);
  assert.equal(selectMsnPopupIndex(31, 100, counts), 20);
  assert.ok(selectMsnPopupIndex(32, 100, counts, () => 0) < 18);
  assert.equal(selectMsnPopupIndex(55, 100, counts), 19);
  assert.ok(selectMsnPopupIndex(80, 100, counts, () => 0) < 18);
});

test('virus and download events fire once and closing them rewards points and relieves chaos', () => {
  const chart = JSON.parse(readFileSync(new URL('../src/config/chart.json', import.meta.url)));
  const music = JSON.parse(
    readFileSync(new URL('../src/config/music-lvl1.analysis.json', import.meta.url)),
  );
  const events = compileChart(chart, music);
  for (const type of WINDOW_TYPES)
    assert.ok(
      events.some((event) => event.type === type),
      type,
    );

  const newEvents = events.filter((event) => ['virus', 'download'].includes(event.type));
  const timeline = new Timeline(newEvents);
  const state = new GameState(chart.gameplay);
  const received = [];
  const close = (event) => {
    received.push(event);
    state.spawn();
    state.update(1);
    assert.ok(state.chaos > 0);
    assert.equal(state.close(), chart.gameplay.pointsPerClose);
    assert.equal(state.chaos, 0);
  };
  timeline.advance(chart.durationSeconds, close);
  timeline.advance(chart.durationSeconds, close);
  assert.deepEqual(received, newEvents);
  assert.equal(state.closed, newEvents.length);
  assert.equal(state.open, 0);
  assert.equal(state.score, newEvents.length * chart.gameplay.pointsPerClose);
});
