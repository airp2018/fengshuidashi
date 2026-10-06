'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const nodemailer = require('nodemailer');
const { createEmailRouter } = require('../router');

test('remembered login survives a fresh server and supports sending without re-entering credentials', async t => {
  let sentMail;
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async mail => { sentMail = mail; },
    close() {}
  }));
  async function start() {
    const app = express();
    app.use(express.json());
    app.use(createEmailRouter({
      feishu: { batchInsertLogs: async () => {} }, getAdminPassword: () => 'test-only',
      logQueue: [], sessionSecret: 'stable-test-session-key'
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const original = await start();
  const response = await fetch(`${original}/api/email/account/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ provider: '163', email: 'test@163.com', auth_code: 'test-only', remember: true })
  });
  assert.equal(response.status, 200);
  const account = await response.json();
  assert.equal(account.remembered, true);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.ok(!setCookie.includes('test-only'));
  const cookie = setCookie.split(';')[0];
  const restarted = await start();
  const status = await fetch(`${restarted}/api/email/account/status`, {
    headers: { Cookie: cookie, Authorization: `Bearer ${account.token}` }
  });
  assert.equal(status.status, 200);
  const restored = await status.json();
  assert.equal(restored.sender, 'test@163.com');
  assert.equal(restored.account_id, account.account_id);
  assert.equal(restored.smtp, undefined);
  assert.equal(restored.auth_code, undefined);
  const form = new FormData();
  for (const [name, value] of Object.entries({ recipient: 'editor@example.com', recipient_label: '测试', subject: '重启后发送', body: '正文', tracking_enabled: 'false' })) form.set(name, value);
  const sent = await fetch(`${restarted}/api/email/send`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  assert.equal(sent.status, 200);
  assert.equal(sentMail.from.address, 'test@163.com');
  const logout = await fetch(`${restarted}/api/email/account/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.match(logout.headers.get('set-cookie'), /emailAccountSession=;/);
  const loggedOut = await fetch(`${restarted}/api/email/account/status`);
  assert.equal(loggedOut.status, 401);

  const temporary = await fetch(`${original}/api/email/account/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: '163', email: 'test@163.com', auth_code: 'test-only', remember: false })
  });
  assert.equal(temporary.status, 200);
  assert.doesNotMatch(temporary.headers.get('set-cookie'), /Max-Age/);
  assert.equal((await temporary.json()).remembered, false);
});
