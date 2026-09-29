'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { permittedDocument, observedAdRequest } = require('./policy.cjs');

test('the app site remains navigable but cannot be confused with a lookalike', () => {
  assert.equal(permittedDocument('https://solanime.pages.dev/watch/example', true), true);
  assert.equal(permittedDocument('https://solanime.pages.dev.evil.test/', true), false);
  assert.equal(permittedDocument('http://solanime.pages.dev/', true), false);
  assert.equal(permittedDocument('https://evil.test@solanime.pages.dev.evil.test/', true), false);
});

test('provider documents can be embedded but never replace Solanime', () => {
  assert.equal(permittedDocument('https://megaplay.buzz/stream/s-2/20121/sub', false), true);
  assert.equal(permittedDocument('https://www.youtube-nocookie.com/embed/example', false), true);
  assert.equal(permittedDocument('https://megaplay.buzz/stream/s-2/20121/sub', true), false);
  assert.equal(permittedDocument('https://wuytg.com/', false), false);
  assert.equal(permittedDocument('javascript:alert(1)', false), false);
  assert.equal(permittedDocument('about:blank', false), true);
  assert.equal(permittedDocument('about:blank', true), false);
});

test('the secondary request filter is exact-host only', () => {
  assert.equal(observedAdRequest('https://wuytg.com/path'), true);
  assert.equal(observedAdRequest('https://sub.wuytg.com/path'), true);
  assert.equal(observedAdRequest('https://notwuytg.com/path'), false);
  assert.equal(observedAdRequest('https://megaplay.buzz/stream'), false);
});
