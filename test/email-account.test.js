'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmailAccountId,
  buildSmtpConfig
} = require('../email-account');

test('creates a stable account id from provider and normalized email', () => {
  assert.equal(
    createEmailAccountId('163', ' AIRP@163.COM '),
    createEmailAccountId('163', 'airp@163.com')
  );
  assert.notEqual(
    createEmailAccountId('qq', 'airp@163.com'),
    createEmailAccountId('163', 'airp@163.com')
  );
});

test('builds a 163 SMTP configuration without exposing custom fields', () => {
  assert.deepEqual(buildSmtpConfig({
    provider: '163',
    email: 'AIRP@163.COM',
    auth_code: 'secret'
  }), {
    provider: '163',
    provider_label: '163邮箱',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    user: 'airp@163.com',
    pass: 'secret'
  });
});

test('rejects account setup without an authorization code', () => {
  assert.throws(
    () => buildSmtpConfig({ provider: 'qq', email: 'person@qq.com' }),
    /授权码/
  );
});
