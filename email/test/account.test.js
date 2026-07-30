'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmailAccountId,
  buildSmtpConfig,
  buildSmtpTransportOptions
} = require('../account');

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
    port: 994,
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

test('builds a safe custom SMTP configuration', () => {
  assert.deepEqual(buildSmtpConfig({
    provider: 'custom',
    email: 'person@yahoo.com',
    auth_code: 'app-password',
    custom_host: 'smtp.mail.yahoo.com',
    custom_port: '465',
    custom_security: 'ssl'
  }), {
    provider: 'custom',
    provider_label: '自定义 SMTP',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    require_tls: false,
    user: 'person@yahoo.com',
    pass: 'app-password'
  });
});

test('rejects unsafe custom SMTP hosts and ports', () => {
  assert.throws(
    () => buildSmtpConfig({
      provider: 'custom',
      email: 'person@example.com',
      auth_code: 'secret',
      custom_host: '127.0.0.1',
      custom_port: '465',
      custom_security: 'ssl'
    }),
    /服务器地址/
  );
  assert.throws(
    () => buildSmtpConfig({
      provider: 'custom',
      email: 'person@example.com',
      auth_code: 'secret',
      custom_host: 'smtp.example.com',
      custom_port: '25',
      custom_security: 'starttls'
    }),
    /端口/
  );
});

test('uses Nodemailer defaults instead of cutting off slow SMTP delivery', () => {
  const options = buildSmtpTransportOptions({
    host: 'smtp.163.com',
    port: 994,
    secure: true,
    user: 'airp@163.com',
    pass: 'secret'
  });

  assert.equal(options.host, 'smtp.163.com');
  assert.equal(options.port, 994);
  assert.equal(options.secure, true);
  assert.equal(options.socketTimeout, undefined);
  assert.equal(options.connectionTimeout, undefined);
  assert.equal(options.greetingTimeout, undefined);
});
