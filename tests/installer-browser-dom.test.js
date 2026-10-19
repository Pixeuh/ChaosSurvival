import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const execFile = promisify(execFileCallback);
const runner = fileURLToPath(new URL('./fixtures/installer-dom-runner.cjs', import.meta.url));

test('both installers advance real progress elements in Electron and delay their fictional failure', async (t) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let stdout;
  try {
    ({ stdout } = await execFile(electron, ['--no-sandbox', runner], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env,
    }));
  } catch (error) {
    if (error.stderr?.includes('Sandboxed processes cannot read')) {
      t.skip('Electron is blocked by the workspace ACL on node_modules/electron/dist.');
      return;
    }
    throw error;
  }
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith('INSTALLER_DOM_RESULT:'));
  assert.ok(resultLine, `Electron returned no DOM result. Output: ${stdout}`);
  const { result, errors } = JSON.parse(resultLine.slice('INSTALLER_DOM_RESULT:'.length));
  assert.doesNotMatch(errors.join('\n'), /Illegal invocation/i);
  assert.deepEqual(errors, [], 'the Electron renderer reported no JavaScript errors');

  for (const [name, expected] of [['smiley', 43], ['toolbar', 78]]) {
    const scenario = result[name];
    assert.equal(scenario.target, expected);
    assert.equal(scenario.initial, 0, `${name} starts at zero percent`);
    assert.ok(scenario.samples[0] > 0 && scenario.samples[0] < expected,
      `${name} has visible progress after one second: ${scenario.samples[0]}`);
    assert.ok(scenario.samples[1] > scenario.samples[0] && scenario.samples[1] < expected,
      `${name} continues progressing after two seconds: ${scenario.samples[1]}`);
    assert.equal(scenario.stopped.value, expected, `${name} stops at its intended percentage`);
    assert.equal(scenario.stopped.step, 'installing', `${name} holds before showing its error`);
    assert.equal(scenario.stopped.cursor, 'progress', `${name} keeps the loading cursor during the hold`);
    assert.equal(scenario.stopped.connected, true, `${name} progress remains in the live DOM`);
    assert.equal(scenario.failed.step, 'failure', `${name} displays its failure after the hold`);
    assert.match(scenario.failed.text, /Impossible à télécharger/);
    assert.notEqual(scenario.failed.cursor, 'progress', `${name} restores the cursor on failure`);
  }
});
