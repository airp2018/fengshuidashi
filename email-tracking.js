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

module.exports = {
  summarizeEmailOpenEvents
};
