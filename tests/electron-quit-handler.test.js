import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQuitHandler } = require('../electron/quit-handler.cjs');

test('Electron quit handler only quits for the trusted game document', () => {
  let quits = 0;
  const handler = createQuitHandler(
    { trustedSender: (event) => event.trusted === true },
    { quit: () => quits++ },
  );
  assert.equal(handler({ trusted: false }), false);
  assert.equal(quits, 0);
  assert.equal(handler({ trusted: true }), true);
  assert.equal(quits, 1);
});
