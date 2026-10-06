'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEmailBody } = require('../body');

test('preserves bold, font size, paragraphs and a plain-text alternative', () => {
  const body = formatEmailBody('编辑您好\n投稿正文', '<div><b>编辑您好</b></div><div><font style="font-size:24px">投稿正文</font></div>');
  assert.equal(body.text, '编辑您好\n投稿正文');
  assert.equal(body.html, '<div><b>编辑您好</b></div><div><span style="font-size:24px">投稿正文</span></div>');
});

test('removes scripts, external images, event handlers and unrelated styles', () => {
  const body = formatEmailBody('正文', '<script>alert(1)</script><img src="https://example.com/pixel"><span onclick="alert(1)" style="font-weight:bold; font-size:18px; background:url(https://example.com/pixel); position:fixed">正文</span>');
  assert.equal(body.html, '<span style="font-weight:bold;font-size:18px">正文</span>');
});

test('plain-text clients retain literal markup, Unicode and line breaks', () => {
  const body = formatEmailBody('中文 <标题> & 内容\n下一行');
  assert.equal(body.html, '中文 &lt;标题&gt; &amp; 内容<br>下一行');
  assert.equal(body.text, '中文 <标题> & 内容\n下一行');
});

test('disallows unsupported or injected font sizes', () => {
  const body = formatEmailBody('正文', '<span style="font-size:999px; color:red">正文</span>');
  assert.equal(body.html, '<span>正文</span>');
});
