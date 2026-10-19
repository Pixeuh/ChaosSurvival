import test from 'node:test';
import assert from 'node:assert/strict';
import { SmileyPackInstaller } from '../src/ui/smiley-pack-installer.js';
import { ToolbarInstaller } from '../src/ui/toolbar-installer.js';

test('both installers invoke the native interval functions with globalThis as their receiver', () => {
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  const calls = [];
  globalThis.setInterval = function (callback, delay) {
    calls.push({ method: 'setInterval', receiver: this, callback, delay });
    return 'test-timer';
  };
  globalThis.clearInterval = function (id) {
    calls.push({ method: 'clearInterval', receiver: this, id });
  };

  try {
    for (const Installer of [SmileyPackInstaller, ToolbarInstaller]) {
      const installer = new Installer({}, {});
      const callback = () => {};
      assert.equal(installer.setInterval(callback, 40), 'test-timer');
      installer.clearInterval('test-timer');
    }
  } finally {
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }

  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.receiver === globalThis));
  assert.deepEqual(calls.map(({ method }) => method), [
    'setInterval', 'clearInterval', 'setInterval', 'clearInterval',
  ]);
});
