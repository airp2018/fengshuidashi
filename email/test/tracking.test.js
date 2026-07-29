'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeEmailOpenEvents,
  summarizeSentEmailEvents
} = require('../tracking');

test('reports no open when the tracking pixel has not loaded', () => {
  assert.deepEqual(summarizeEmailOpenEvents([]), {
    tracking_state: 'not_loaded',
    opened: false,
    open_count: 0,
    first_opened_at: null,
    last_opened_at: null,
    raw_open_count: 0,
    suspected_automated_count: 0,
    last_suspected_at: null
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
        '测算场景': '第一封投稿',
        '设备尺寸': JSON.stringify({
          recipient_label: '钟山',
          recipient_email: 'tougao@example.com'
        })
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
      recipient_label: '',
      recipient_email: '',
      email_name: '第二封投稿',
      tracking_enabled: false,
      tracking_id: null
    },
    {
      sent_at: '2026/7/28 22:00:00',
      recipient_label: '钟山',
      recipient_email: 'tougao@example.com',
      email_name: '第一封投稿',
      tracking_enabled: true,
      tracking_id: 'first'
    }
  ]);
});

test('keeps sent history isolated by sender account', () => {
  const records = [
    {
      created_time: '100',
      fields: {
        '设备 ID': 'email:account-a-message',
        '时间': '2026/7/29 10:00:00',
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '测算场景': 'A 的投稿',
        '设备尺寸': JSON.stringify({
          sender_account_id: 'account-a',
          recipient_email: 'a@example.com'
        })
      }
    },
    {
      created_time: '200',
      fields: {
        '设备 ID': 'email:account-b-message',
        '时间': '2026/7/29 11:00:00',
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '测算场景': 'B 的投稿',
        '设备尺寸': JSON.stringify({
          sender_account_id: 'account-b',
          recipient_email: 'b@example.com'
        })
      }
    }
  ];

  const sent = summarizeSentEmailEvents(records, 100, { account_id: 'account-a' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].email_name, 'A 的投稿');
  assert.equal(sent[0].recipient_email, 'a@example.com');
});

test('reads sent history when Feishu returns text fields as rich-text arrays', () => {
  const asFeishuText = text => [{ type: 'text', text }];
  const sent = summarizeSentEmailEvents([{
    created_time: '300',
    fields: {
      '设备 ID': asFeishuText('email:persisted-message'),
      '时间': asFeishuText('2026/7/29 17:53:30'),
      '事件类型': asFeishuText('投稿邮件已发送（跟踪开启）'),
      '测算场景': asFeishuText('重新登录后仍应显示'),
      '设备尺寸': asFeishuText(JSON.stringify({
        sender_account_id: 'account-a',
        recipient_label: '钟山',
        recipient_email: 'tougao@example.com'
      }))
    }
  }], 100, { account_id: 'account-a' });

  assert.deepEqual(sent, [{
    sent_at: '2026/7/29 17:53:30',
    recipient_label: '钟山',
    recipient_email: 'tougao@example.com',
    email_name: '重新登录后仍应显示',
    tracking_enabled: true,
    tracking_id: 'persisted-message'
  }]);
});

test('assigns untagged legacy history only to the configured legacy account', () => {
  const records = [{
    created_time: '100',
    fields: {
      '设备 ID': 'email:legacy-message',
      '事件类型': '投稿邮件已发送（跟踪开启）',
      '测算场景': '旧投稿'
    }
  }];

  assert.equal(summarizeSentEmailEvents(records, 100, {
    account_id: 'legacy-account',
    legacy_account_id: 'legacy-account'
  }).length, 1);
  assert.equal(summarizeSentEmailEvents(records, 100, {
    account_id: 'other-account',
    legacy_account_id: 'legacy-account'
  }).length, 0);
});

test('summarizes tracking pixel loads in chronological order', () => {
  const status = summarizeEmailOpenEvents([
    {
      created_time: '300000',
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/28 23:42:00',
        '设备环境 (UserAgent)': 'Mozilla/5.0'
      }
    },
    {
      created_time: '200000',
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/28 23:40:00',
        '设备环境 (UserAgent)': 'Mozilla/5.0'
      }
    },
    {
      created_time: '100',
      fields: { '事件类型': '投稿邮件已发送（跟踪开启）', '时间': '2026/7/28 23:41:00' }
    }
  ]);

  assert.deepEqual(status, {
    tracking_state: 'possible_human',
    opened: true,
    open_count: 2,
    first_opened_at: '2026/7/28 23:40:00',
    last_opened_at: '2026/7/28 23:42:00',
    raw_open_count: 2,
    suspected_automated_count: 0,
    last_suspected_at: null
  });
});

test('filters an image load that happens seconds after SMTP delivery', () => {
  const status = summarizeEmailOpenEvents([
    {
      created_time: String(Date.parse('2026-07-29T09:24:04+08:00')),
      fields: {
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '时间': '2026/7/29 09:24:04'
      }
    },
    {
      created_time: String(Date.parse('2026-07-29T09:24:12+08:00')),
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/29 09:24:12'
      }
    }
  ]);

  assert.deepEqual(status, {
    tracking_state: 'mail_system_loaded',
    opened: false,
    open_count: 0,
    first_opened_at: null,
    last_opened_at: null,
    raw_open_count: 1,
    suspected_automated_count: 1,
    last_suspected_at: '2026/7/29 09:24:12'
  });
});

test('does not reject an immediate load when it has ordinary client metadata', () => {
  const sentAt = Date.parse('2026-07-29T09:24:04+08:00');
  const status = summarizeEmailOpenEvents([
    {
      created_time: String(sentAt),
      fields: {
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '时间': '2026/7/29 09:24:04'
      }
    },
    {
      created_time: String(sentAt + 8 * 1000),
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/29 09:24:12',
        '设备环境 (UserAgent)': 'Mozilla/5.0'
      }
    }
  ]);

  assert.equal(status.tracking_state, 'possible_human');
  assert.equal(status.opened, true);
  assert.equal(status.open_count, 1);
});

test('filters known image proxies even when they load later', () => {
  const status = summarizeEmailOpenEvents([
    {
      created_time: '100',
      fields: {
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '时间': '2026/7/29 09:00:00'
      }
    },
    {
      created_time: '200000',
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/29 10:00:00',
        '设备环境 (UserAgent)': 'Mozilla/5.0 GoogleImageProxy'
      }
    }
  ]);

  assert.equal(status.opened, false);
  assert.equal(status.tracking_state, 'mail_system_loaded');
  assert.equal(status.raw_open_count, 1);
  assert.equal(status.suspected_automated_count, 1);
});

test('keeps a later ordinary mail-client image load as a possible human open', () => {
  const sentAt = Date.parse('2026-07-29T09:00:00+08:00');
  const status = summarizeEmailOpenEvents([
    {
      created_time: String(sentAt),
      fields: {
        '事件类型': '投稿邮件已发送（跟踪开启）',
        '时间': '2026/7/29 09:00:00'
      }
    },
    {
      created_time: String(sentAt + 10 * 60 * 1000),
      fields: {
        '事件类型': '邮件跟踪像素加载',
        '时间': '2026/7/29 09:10:00',
        '设备环境 (UserAgent)': 'Mozilla/5.0'
      }
    }
  ]);

  assert.equal(status.opened, true);
  assert.equal(status.tracking_state, 'possible_human');
  assert.equal(status.open_count, 1);
  assert.equal(status.suspected_automated_count, 0);
});
