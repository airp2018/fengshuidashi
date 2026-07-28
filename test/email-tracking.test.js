'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeEmailOpenEvents } = require('../email-tracking');

test('reports no open when the tracking pixel has not loaded', () => {
  assert.deepEqual(summarizeEmailOpenEvents([]), {
    opened: false,
    open_count: 0,
    first_opened_at: null,
    last_opened_at: null
  });
});

test('summarizes tracking pixel loads in chronological order', () => {
  const status = summarizeEmailOpenEvents([
    {
      created_time: '200',
      fields: { '事件类型': '邮件跟踪像素加载', '时间': '2026/7/28 23:42:00' }
    },
    {
      created_time: '100',
      fields: { '事件类型': '邮件跟踪像素加载', '时间': '2026/7/28 23:40:00' }
    },
    {
      created_time: '150',
      fields: { '事件类型': '投稿邮件已发送（跟踪开启）', '时间': '2026/7/28 23:41:00' }
    }
  ]);

  assert.deepEqual(status, {
    opened: true,
    open_count: 2,
    first_opened_at: '2026/7/28 23:40:00',
    last_opened_at: '2026/7/28 23:42:00'
  });
});
