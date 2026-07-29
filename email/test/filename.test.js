'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUploadFilename } = require('../filename');

test('repairs UTF-8 upload filenames decoded as Latin-1', () => {
  assert.equal(
    normalizeUploadFilename('åè£è¦å»çè±ªå®.docx'),
    '假装要去看豪宅.docx'
  );
});

test('leaves ASCII and already-correct Unicode filenames unchanged', () => {
  assert.equal(normalizeUploadFilename('submission.docx'), 'submission.docx');
  assert.equal(normalizeUploadFilename('假装要去看豪宅.docx'), '假装要去看豪宅.docx');
});

test('does not corrupt a valid Latin-1 filename that is not UTF-8 bytes', () => {
  assert.equal(normalizeUploadFilename('café.pdf'), 'café.pdf');
});
