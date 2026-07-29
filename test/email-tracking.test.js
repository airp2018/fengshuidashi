'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeEmailOpenEvents,
  summarizeSentEmailEvents
} = require('../email-tracking');

test('reports no open when the tracking pixel has not loaded', () => {
  assert.deepEqual(summarizeEmailOpenEvents([]), {
    opened: false,
    open_count: 0,
    first_opened_at: null,
    last_opened_at: null
  });
});

test('builds a newest-first sent email list without duplicate tracking IDs', () => {
  const sent = summarizeSentEmailEvents([
    {
      created_time: '100',
      fields: {
        '设备 ID': 'email:first',
        '时间': '2026/7/28 22:00:00',
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '测算场景': '第一封投稿'
      }
    },
    {
      created_time: '200',
      fields: {
        '设备 ID': 'email:second',
        '时间': '2026/7/28 23:00:00',
        '事件类型': '投稿邮件已发送（跟踪关闭）',
        '测算场景': '第二封投稿'
      }
    },
    {
      created_time: '100',
      fields: {
        '设备 ID': 'email:first',
        '时间': '2026/7/28 22:00:00',
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '测算场景': '重复记录'
      }
    }
  ]);

  assert.deepEqual(sent, [
    {
      sent_at: '2026/7/28 23:00:00',
      email_name: '第二封投稿',
      tracking_enabled: false,
      tracking_id: null
    },
    {
      sent_at: '2026/7/28 22:00:00',
      email_name: '第一封投稿',
      tracking_enabled: true,
      tracking_id: 'first'
    }
  ]);
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
