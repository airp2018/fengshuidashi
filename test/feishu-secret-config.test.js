const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Feishu app secret is read from the environment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'feishu.js'), 'utf8');

  assert.equal(
    /const APP_SECRET = process\.env\.FEISHU_APP_SECRET;/.test(source),
    true,
    'APP_SECRET must read FEISHU_APP_SECRET from the environment',
  );
  assert.equal(
    /const APP_SECRET = ['"][^'"]+['"];?/.test(source),
    false,
    'APP_SECRET must not contain an inline value',
  );
});
