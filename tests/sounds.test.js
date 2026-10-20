import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopSounds } from '../src/audio/sounds.js';

test('Wizz sound is a short original Web Audio buzz with a vibrating frequency sweep', () => {
  const calls = [];
  const parameter = (name) => ({
    setValueAtTime: (value, time) => calls.push([name, 'set', value, time]),
    linearRampToValueAtTime: (value, time) => calls.push([name, 'linear', value, time]),
    exponentialRampToValueAtTime: (value, time) => calls.push([name, 'exponential', value, time]),
  });
  const oscillator = {
    frequency: parameter('frequency'),
    connect: (node) => calls.push(['connect', 'oscillator', node]),
    start: (time) => calls.push(['start', time]),
    stop: (time) => calls.push(['stop', time]),
    disconnect: () => calls.push(['disconnect', 'oscillator']),
  };
  const filter = {
    frequency: parameter('filter-frequency'),
    Q: parameter('filter-q'),
    connect: (node) => calls.push(['connect', 'filter', node]),
    disconnect: () => calls.push(['disconnect', 'filter']),
  };
  const gain = {
    gain: parameter('gain'),
    connect: (node) => calls.push(['connect', 'gain', node]),
    disconnect: () => calls.push(['disconnect', 'gain']),
  };
  const context = {
    state: 'running',
    currentTime: 4,
    destination: {},
    createOscillator: () => oscillator,
    createBiquadFilter: () => filter,
    createGain: () => gain,
  };
  const sounds = new DesktopSounds(() => 0.7, () => context);

  sounds.play('wizz');

  assert.equal(oscillator.type, 'sawtooth');
  const frequencyCalls = calls.filter(([name]) => name === 'frequency');
  assert.deepEqual(frequencyCalls[0], ['frequency', 'set', 360, 4]);
  assert.deepEqual(
    frequencyCalls.filter(([, kind]) => kind === 'linear').map(([, , value]) => value),
    [1180, 240, 1040, 310, 1320, 420, 260],
  );
  assert.ok(calls.some(([name, kind, value]) => name === 'gain' && kind === 'exponential' && value === 0.001));
  assert.ok(calls.some(([name, time]) => name === 'stop' && Math.abs(time - 4.4) < 1e-9));
});

test('successive Wizz calls create independent voices without cutting off the previous one', () => {
  const oscillators = [];
  const parameter = {
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  const context = {
    state: 'running',
    currentTime: 4,
    destination: {},
    createOscillator() {
      const oscillator = {
        frequency: parameter,
        connect() {},
        start(time) { this.startedAt = time; },
        stop(time) { this.stoppedAt = time; },
        disconnect() {},
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createBiquadFilter: () => ({ frequency: parameter, Q: parameter, connect() {}, disconnect() {} }),
    createGain: () => ({ gain: parameter, connect() {}, disconnect() {} }),
  };
  const sounds = new DesktopSounds(() => 0.7, () => context);

  sounds.play('wizz');
  sounds.play('wizz');

  assert.equal(oscillators.length, 2);
  assert.deepEqual(oscillators.map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]), [
    [4, 4.4],
    [4, 4.4],
  ]);
});

test('sound unlock resumes an existing context and supports the WebKit constructor fallback', async (t) => {
  const previousWindow = globalThis.window;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const context = {
    state: 'suspended',
    async resume() { this.state = 'running'; },
  };
  globalThis.window = { webkitAudioContext: class { constructor() { return context; } } };
  const sounds = new DesktopSounds(() => 0.7, () => null);

  assert.equal(await sounds.unlock(), true);
  assert.equal(sounds.context, context);
  assert.equal(context.state, 'running');
});
