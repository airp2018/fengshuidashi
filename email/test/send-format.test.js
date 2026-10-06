'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const nodemailer = require('nodemailer');
const { createEmailRouter } = require('../router');

test('send endpoint passes sanitized HTML, plain text and multiple attachments to SMTP', async t => {
  let sentMail;
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async mail => { sentMail = mail; },
    close() {}
  }));
  const app = express();
  app.use(express.json());
  app.use(createEmailRouter({
    feishu: { batchInsertLogs: async () => {} },
    getAdminPassword: () => 'test-only', logQueue: []
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/email/account/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: '163', email: 'test@163.com', auth_code: 'test-only' })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const data = new FormData();
  data.set('recipient', 'editor@example.com');
  data.set('recipient_label', '测试刊物');
  data.set('subject', '格式测试');
  data.set('body', '编辑您好\n投稿正文');
  data.set('body_html', '<b>编辑您好</b><br><font style="font-size:24px">投稿正文</font><script>alert(1)</script>');
  data.set('tracking_enabled', 'false');
  data.append('attachments', new Blob(['first']), 'first.txt');
  data.append('attachments', new Blob(['second']), 'second.txt');
  const response = await fetch(`${base}/api/email/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data
  });
  assert.equal(response.status, 200);
  assert.equal(sentMail.text, '编辑您好\r\n投稿正文');
  assert.match(sentMail.html, /<b>编辑您好<\/b><br \/><span style="font-size:24px">投稿正文<\/span>/);
  assert.doesNotMatch(sentMail.html, /script|alert\(1\)/);
  assert.deepEqual(sentMail.attachments.map(file => file.filename), ['first.txt', 'second.txt']);
  assert.deepEqual(sentMail.attachments.map(file => file.content.toString()), ['first', 'second']);
});
