'use strict';

function summarizeEmailOpenEvents(records) {
  const opens = (records || [])
    .filter(record => record?.fields?.['事件类型'] === '邮件跟踪像素加载')
    .sort((left, right) => Number(left.created_time || 0) - Number(right.created_time || 0));

  return {
    opened: opens.length > 0,
    open_count: opens.length,
    first_opened_at: opens[0]?.fields?.['时间'] || null,
    last_opened_at: opens.at(-1)?.fields?.['时间'] || null
  };
}

function summarizeSentEmailEvents(records, limit = 100) {
  const sentRecords = (records || [])
    .filter(record => String(record?.fields?.['事件类型'] || '').startsWith('投稿邮件已发送'))
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
    result.push({
      sent_at: fields['时间'] || null,
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
  summarizeSentEmailEvents
};
