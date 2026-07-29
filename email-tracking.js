'use strict';

const AUTOMATED_USER_AGENT_PATTERN =
  /(bot|crawler|spider|scanner|preview|prefetch|googleimageproxy|appleprivacy|mimecast|proofpoint|barracuda|safelinks|urlscan|curl|wget|python|axios|okhttp|headless)/i;

function uniqueRecords(records) {
  const seen = new Set();
  return (records || []).filter(record => {
    const fields = record?.fields || {};
    const signature = [
      fields['事件类型'] || '',
      fields['时间'] || '',
      fields['IP 地址'] || '',
      fields['设备环境 (UserAgent)'] || ''
    ].join('\u0000');
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function isSuspectedAutomatedOpen(record) {
  const fields = record?.fields || {};
  const userAgent = String(fields['设备环境 (UserAgent)'] || '').trim();
  return !userAgent || AUTOMATED_USER_AGENT_PATTERN.test(userAgent);
}

function summarizeEmailOpenEvents(records) {
  const unique = uniqueRecords(records);
  const opens = unique
    .filter(record => record?.fields?.['事件类型'] === '邮件跟踪像素加载')
    .sort((left, right) => Number(left.created_time || 0) - Number(right.created_time || 0));
  const suspectedAutomated = opens.filter(isSuspectedAutomatedOpen);
  const suspectedSet = new Set(suspectedAutomated);
  const possibleHumanOpens = opens.filter(record => !suspectedSet.has(record));

  return {
    tracking_state: possibleHumanOpens.length > 0
      ? 'possible_human'
      : opens.length > 0
        ? 'mail_system_loaded'
        : 'not_loaded',
    opened: possibleHumanOpens.length > 0,
    open_count: possibleHumanOpens.length,
    first_opened_at: possibleHumanOpens[0]?.fields?.['时间'] || null,
    last_opened_at: possibleHumanOpens.at(-1)?.fields?.['时间'] || null,
    raw_open_count: opens.length,
    suspected_automated_count: suspectedAutomated.length,
    last_suspected_at: suspectedAutomated.at(-1)?.fields?.['时间'] || null
  };
}

function getSentEmailMetadata(record) {
  try {
    return JSON.parse(String(record?.fields?.['设备尺寸'] || '{}'));
  } catch {
    return {};
  }
}

function isSentEmailRecordForAccount(record, accountId, legacyAccountId = '') {
  const eventType = String(record?.fields?.['事件类型'] || '');
  if (!eventType.startsWith('投稿邮件已发送')) return false;
  const metadata = getSentEmailMetadata(record);
  const recordAccountId = String(metadata.sender_account_id || legacyAccountId || '');
  return Boolean(accountId) && recordAccountId === accountId;
}

function summarizeSentEmailEvents(records, limit = 100, options = {}) {
  const accountId = String(options.account_id || '');
  const legacyAccountId = String(options.legacy_account_id || '');
  const sentRecords = (records || [])
    .filter(record => String(record?.fields?.['事件类型'] || '').startsWith('投稿邮件已发送'))
    .filter(record => !accountId || isSentEmailRecordForAccount(record, accountId, legacyAccountId))
    .sort((left, right) => Number(right.created_time || 0) - Number(left.created_time || 0));
  const seen = new Set();
  const result = [];

  for (const record of sentRecords) {
    const fields = record.fields || {};
    const deviceId = String(fields['设备 ID'] || '');
    if (!deviceId.startsWith('email:')) continue;

    const trackingId = deviceId.slice('email:'.length);
    if (!trackingId || seen.has(trackingId)) continue;
    seen.add(trackingId);

    const trackingEnabled = fields['事件类型'] === '投稿邮件已发送（跟踪开启）';
    const metadata = getSentEmailMetadata(record);
    result.push({
      sent_at: fields['时间'] || null,
      recipient_label: String(metadata.recipient_label || ''),
      recipient_email: String(metadata.recipient_email || ''),
      email_name: fields['测算场景'] || '未命名邮件',
      tracking_enabled: trackingEnabled,
      tracking_id: trackingEnabled ? trackingId : null
    });

    if (result.length >= limit) break;
  }

  return result;
}

module.exports = {
  summarizeEmailOpenEvents,
  summarizeSentEmailEvents,
  getSentEmailMetadata,
  isSentEmailRecordForAccount
};
