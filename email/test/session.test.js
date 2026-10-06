'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionCodec, SESSION_TTL_MS, REMEMBER_TTL_MS } = require('../session');

const secret = 'test-session-encryption-secret';
const session = {
  accountId: 'test-account', smtp: { user: 'test@example.com', pass: 'test-only-authorization-code' },
  expiresAt: Date.now() + REMEMBER_TTL_MS
};

test('encrypted session can be restored with the same key after restart', () => {
  const token = createSessionCodec(secret).seal(session);
  assert.deepEqual(createSessionCodec(secret).open(token), session);
  assert.ok(!token.includes(session.smtp.pass));
  assert.ok(!token.includes(session.smtp.user));
});

test('rejects tampering, a different key and expired sessions', () => {
  const codec = createSessionCodec(secret);
  const token = codec.seal(session);
  const tampered = token.slice(0, 40) + (token[40] === 'A' ? 'B' : 'A') + token.slice(41);
  assert.equal(codec.open(tampered), null);
  assert.equal(createSessionCodec('different-test-key').open(token), null);
  assert.equal(codec.open(token, session.expiresAt), null);
});

test('does not enable persistent sessions without a secret', () => {
  assert.equal(createSessionCodec(''), null);
  assert.equal(SESSION_TTL_MS, 12 * 60 * 60 * 1000);
  assert.equal(REMEMBER_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});
