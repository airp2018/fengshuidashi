'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPaginatedRecords } = require('../feishu');

test('collects every Feishu page using the returned page token', async () => {
  const requestedTokens = [];
  const records = await collectPaginatedRecords(async pageToken => {
    requestedTokens.push(pageToken);
    if (!pageToken) {
      return {
        items: [{ record_id: 'first' }],
        has_more: true,
        page_token: 'next-page'
      };
    }
    return {
      items: [{ record_id: 'second' }],
      has_more: false
    };
  });

  assert.deepEqual(requestedTokens, ['', 'next-page']);
  assert.deepEqual(records.map(record => record.record_id), ['first', 'second']);
});

test('rejects an invalid Feishu page that claims more data without a token', async () => {
  await assert.rejects(
    collectPaginatedRecords(async () => ({ items: [], has_more: true })),
    /page_token/
  );
});
