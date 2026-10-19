import test from 'node:test';
import assert from 'node:assert/strict';
import { createBombArenaAudio } from '../src/minigames/bomb-arena/audio.js';
import { createArenaEffects, renderBombArena, renderCharacterRoster, renderCollisionDiagnostics } from '../src/minigames/bomb-arena/presentation.js';
import { createGame, getCollisionDebugData } from '../src/minigames/bomb-arena/engine.js';
import { PLAYER_COLORS } from '../src/minigames/bomb-arena/player-colors.js';
import { BOMB_ARENA_RESULTS_DISPLAY_MS, createResultsAutoReturn, isArenaTextEntryTarget } from '../src/minigames/bomb-arena/view.js';

function state() {
  return {
    bombs: [], fires: [], blocks: new Set(['4,4']), bonuses: [], phase: 'playing', roundTime: 0,
    players: [{ id: 'justme', x: 1.5, y: 1.5, alive: true, color: '#56d45d', controls: {} }],
  };
}

test('BombArena presentation effects react to engine snapshots without changing gameplay state', () => {
  const sounds = [];
  const effects = createArenaEffects({ onSound: (name) => sounds.push(name), rng: () => .25 });
  const game = state();
  effects.observe(game, 16, 100);
  game.bombs.push({ id: 'bomb-1', x: 2, y: 2, owner: 'justme' });
  game.players[0].x = 1.7;
  effects.observe(game, 16, 116);
  assert.equal(sounds.includes('bomb'), true);
  assert.equal(effects.motion('justme').moving, true);
  assert.equal(effects.motion('justme').direction, 'right');
  assert.equal(effects.poses.get('justme') > 116, true);

  game.bombs = [];
  game.blocks.delete('4,4');
  game.bonuses.push({ x: 3, y: 3, type: 'speed' });
  effects.observe(game, 16, 132);
  assert.equal(sounds.includes('explosion'), true);
  assert.equal(sounds.includes('block'), true);
  assert.ok(effects.particles.length > 0);
  const originalBlocks = new Set(game.blocks);
  effects.observe(game, 50, 182);
  assert.deepEqual(game.blocks, originalBlocks, 'presentation effects never alter engine collision state');

  game.players[0].alive = false;
  effects.observe(game, 16, 198);
  assert.equal(sounds.includes('elimination'), true);
  assert.equal(effects.defeated.has('justme'), true, 'a short visual elimination pose is retained outside gameplay state');
  effects.observe(game, 500, 700);
  assert.equal(effects.defeated.has('justme'), false);

  const roundReset = state(); roundReset.round = 1;
  const resetSounds = [], resetEffects = createArenaEffects({ onSound: (name) => resetSounds.push(name) });
  resetEffects.observe(roundReset, 16, 0);
  roundReset.round = 2; roundReset.blocks = new Set(['5,5']); roundReset.bombs = []; roundReset.fires = [];
  resetEffects.observe(roundReset, 16, 16);
  assert.deepEqual(resetSounds, [], 'a fresh round is not mistaken for block destruction or an explosion');
});

test('BombArena walk pose and facing survive render frames between fixed simulation steps', () => {
  const effects = createArenaEffects();
  const game = state();
  game.players.push(
    { id: 'pixelgirl', x: 3.5, y: 3.5, alive: true, controls: {} },
    { id: 'turbo', x: 5.5, y: 5.5, alive: true, controls: {} },
    { id: 'luna', x: 7.5, y: 7.5, alive: true, controls: {} },
  );
  effects.observe(game, 16, 100);
  game.players[0].x += .05;
  game.players[1].x += .05;
  game.players[2].x -= .05;
  game.players[3].y += .05;
  effects.observe(game, 16, 116);
  assert.deepEqual(effects.motion('justme'), { moving: true, direction: 'right', lastMovedAt: 116 });
  assert.deepEqual(
    game.players.map((player) => effects.motion(player.id).moving),
    [true, true, true, true],
    'JustMe and all three NPCs use the same movement sampling rule',
  );

  // A render-only frame has no new simulation position, but must not switch to idle.
  effects.observe(game, 8, 124);
  assert.equal(effects.motion('justme').moving, true);
  assert.equal(effects.motion('justme').direction, 'right');

  game.players[0].y -= .05;
  effects.observe(game, 16, 140);
  assert.equal(effects.motion('justme').direction, 'up');
  effects.observe(game, 16, 220);
  assert.equal(effects.motion('justme').moving, true, 'the short movement hold covers jitter around a simulation tick');
  effects.observe(game, 16, 240);
  assert.equal(effects.motion('justme').moving, false, 'the walk pose returns to idle shortly after movement stops');
});

class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.closed = false; this.oscillators = []; FakeAudioContext.last = this; }
  createGain() { return { gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() {
    const oscillator = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
    this.oscillators.push(oscillator); return oscillator;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; this.closed = true; }
}

test('BombArena Web Audio effects unlock on demand, support volume and mute, pause queued cues, and dispose', async () => {
  const audio = createBombArenaAudio({ AudioContextCtor: FakeAudioContext });
  assert.equal(audio.hasMusic, false, 'no unrelated local track is presented as BombArena music');
  assert.equal(audio.play('select'), false, 'audio waits for a user gesture');
  await audio.unlock();
  assert.equal(audio.play('bomb'), true);
  audio.setSfxVolume(.3);
  audio.setMuted(true);
  assert.equal(audio.play('explosion'), false);
  audio.setMuted(false);
  audio.setPaused(true);
  assert.equal(audio.play('bonus'), false);
  audio.setPaused(false);
  assert.equal(audio.play('victory'), true);
  const context = audio;
  audio.dispose();
  assert.equal(audio.play('select'), false);
  assert.ok(context);
  assert.equal(FakeAudioContext.last.closed, true, 'closing the game releases its Web Audio context');
});

test('BombArena arena and roster renderer draw engine state through a reusable canvas renderer', () => {
  const calls = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key === 'roundRect' || key === 'ellipse' || key === 'arc' || key === 'moveTo' || key === 'lineTo' || key === 'quadraticCurveTo' || key === 'bezierCurveTo' || key === 'closePath' || key === 'beginPath' || key === 'fill' || key === 'stroke' || key === 'fillRect' || key === 'strokeRect' || key === 'clearRect' || key === 'save' || key === 'restore' || key === 'translate' || key === 'scale' || key === 'fillText') return (...args) => calls.push([key, ...args]);
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = { width: 780, height: 660 };
  const game = createGame({ rng: () => .2 }); game.phase = 'playing';
  const originalBlocks = new Set(game.blocks);
  const effects = createArenaEffects({ rng: () => .4 }); effects.observe(game, 16, 100);
  renderBombArena(context, canvas, game, effects, 100);
  renderCharacterRoster(context, { width: 520, height: 105 }, 100);
  assert.ok(calls.some(([method]) => method === 'fillRect'), 'the environment uses the canvas presentation layer');
  assert.ok(calls.some(([method]) => method === 'ellipse'), 'characters and rounded arcade effects are rendered');
  assert.deepEqual(game.blocks, originalBlocks, 'rendering does not change destructible collision state');
});

test('BombArena player identities use distinct team colors, including Turbo green and JustMe gold', () => {
  assert.equal(PLAYER_COLORS.turbo, '#27d68b');
  assert.equal(PLAYER_COLORS.justme, '#f2c94c');
  assert.equal(PLAYER_COLORS.pixelgirl, '#ff74b9');
  assert.equal(PLAYER_COLORS.luna, '#8b83fa');
  assert.equal(new Set(Object.values(PLAYER_COLORS)).size, 4);
});

test('BombArena results auto-return schedules one five-second transition and can be cancelled', () => {
  const scheduled = [], cleared = [], returned = [];
  const automatic = createResultsAutoReturn(() => returned.push('timer'), {
    setTimeoutFn(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeoutFn(id) { cleared.push(id); },
  });
  assert.equal(BOMB_ARENA_RESULTS_DISPLAY_MS, 5000);
  assert.equal(automatic.start(), true);
  assert.equal(automatic.start(), false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 5000);
  scheduled[0].callback();
  assert.deepEqual(returned, ['timer']);
  assert.equal(automatic.start(), false, 'a completed timer cannot schedule a duplicate transition');

  const cancelled = createResultsAutoReturn(() => returned.push('cancelled'), {
    setTimeoutFn(callback, delay) { scheduled.push({ callback, delay }); return 2; },
    clearTimeoutFn(id) { cleared.push(id); },
  });
  cancelled.start();
  assert.equal(cancelled.cancel(), true);
  assert.deepEqual(cleared, [2]);
  assert.equal(cancelled.cancel(), false);
});

test('BombArena movement ignores focused buttons but still protects text-entry controls', () => {
  const button = { closest: (selector) => selector.includes('button') ? button : null };
  const input = { closest: (selector) => selector.includes('input') ? input : null };
  assert.equal(isArenaTextEntryTarget(button), false);
  assert.equal(isArenaTextEntryTarget(input), true);
  assert.equal(isArenaTextEntryTarget(null), false);
});

test('development collision diagnostics draw the logical grid, actual colliders, damage tiles, and last refusal', () => {
  const calls = { line: 0, rect: 0, rounded: 0, arc: 0, text: [] };
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, rect() {}, roundRect() { calls.rounded++; }, moveTo() {}, lineTo() { calls.line++; },
    stroke() {}, fill() {}, fillRect() {}, strokeRect() { calls.rect++; },
    arc() { calls.arc++; }, fillText(text) { calls.text.push(text); },
  };
  const game = createGame({ rng: () => .9 });
  game.bombs = [{ id: 'diag-bomb', x: 3, y: 3, exploded: false }];
  game.fires = [{ owner: 'turbo', cells: [{ x: 4, y: 3 }], remaining: 250 }];
  game.lastMovementBlock = { playerId: 'justme', attempted: { x: 2.8, y: 1.5 }, blocker: { type: 'wall', x: 3, y: 1, id: null } };
  const geometry = getCollisionDebugData(game);
  renderCollisionDiagnostics(ctx, { width: 780, height: 660 }, game);
  assert.equal(calls.line, 26, 'all thirteen columns and eleven rows are drawn');
  assert.ok(calls.rounded >= geometry.obstacles.length);
  assert.ok(calls.rect >= geometry.explosions.length + geometry.bombs.length);
  assert.ok(calls.arc >= geometry.players.length, 'all live player hitboxes and the refused destination are shown');
  assert.ok(calls.text.some((text) => text.includes('wall (3, 1)')),
    'the latest refused move names the blocking wall cell');
});
