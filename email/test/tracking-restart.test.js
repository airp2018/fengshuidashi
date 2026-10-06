'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const nodemailer = require('nodemailer');
const { createEmailRouter } = require('../router');
const { createEmailAccountId } = require('../account');

test('persisted rich-text tracking records survive restart and retain sender isolation', async t => {
  const rich = text => [{ type: 'text', text }];
  const trackingId = 'persisted-tracking-test';
  const ownerId = createEmailAccountId('163', 'owner@163.com');
  const persisted = [{
    created_time: '1000', fields: {
      '设备 ID': rich(`email:${trackingId}`),
      '事件类型': rich('投稿邮件已发送（跟踪开启）'),
      '时间': rich('2026/10/6 17:37:40'),
      '设备尺寸': rich(JSON.stringify({ sender_account_id: ownerId }))
    }
  }, {
    created_time: '2000', fields: {
      '设备 ID': rich(`email:${trackingId}`),
      '事件类型': rich('邮件跟踪像素加载'),
      '时间': rich('2026/10/6 17:38:40'),
      'IP 地址': rich('127.0.0.1'),
      '设备环境 (UserAgent)': rich('Mozilla/5.0 Thunderbird')
    }
  }];
  t.mock.method(nodemailer, 'createTransport', () => ({ verify: async () => true, close() {} }));
  const app = express();
  app.use(express.json());
  app.use(createEmailRouter({
    feishu: { findEmailTrackingEvents: async () => persisted },
    getAdminPassword: () => 'test-only', logQueue: []
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(email) {
    const response = await fetch(`${base}/api/email/account/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: '163', email, auth_code: 'test-only' })
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  }
  const ownerToken = await login('owner@163.com');
  const response = await fetch(`${base}/api/email/tracking/${trackingId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.open_count, 1);
  assert.equal(status.last_opened_at, '2026/10/6 17:38:40');
  const otherToken = await login('other@163.com');
  const denied = await fetch(`${base}/api/email/tracking/${trackingId}`, {
    headers: { Authorization: `Bearer ${otherToken}` }
  });
  assert.equal(denied.status, 404);
});
