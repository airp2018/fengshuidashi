'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { File } = require('node:buffer');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const functions = html.slice(html.indexOf('    function renderFiles()'), html.indexOf('    function showComposeView()'));

function setup() {
  const messages = [];
  function element() {
    return {
      children: [], listeners: {},
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      setAttribute() {},
      addEventListener(name, callback) { this.listeners[name] = callback; }
    };
  }
  const input = { files: [], value: '' };
  const list = element();
  const context = vm.createContext({
    attachments: input, fileList: list,
    document: { createElement: element },
    formatBytes: bytes => `${bytes} B`,
    showMessage: message => messages.push(message)
  });
  vm.runInContext(`let selectedAttachments = [];\n${functions}`, context);
  return {
    input, list, messages,
    add(files) { input.files = files; input.value = 'selection'; vm.runInContext('addAttachments()', context); },
    payload() {
      const data = new FormData();
      data.append('attachments', new File([], 'empty-placeholder'));
      context.data = data;
      vm.runInContext('appendAttachments(data)', context);
      return data.getAll('attachments');
    }
  };
}

test('separate selections preserve both attachments in the outgoing payload', () => {
  const app = setup();
  app.add([new File(['first'], '第一稿.txt')]);
  app.add([new File(['second'], '第二稿.txt')]);
  assert.deepEqual(app.payload().map(file => file.name), ['第一稿.txt', '第二稿.txt']);
  assert.equal(app.list.children.length, 2);
  assert.equal(app.input.value, '');
});

test('removing one file preserves the other file and its payload', () => {
  const app = setup();
  app.add([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
  app.list.children[0].children[0].listeners.click();
  assert.deepEqual(app.payload().map(file => file.name), ['b.txt']);
  assert.equal(app.list.children.length, 1);
});

test('a sixth attachment is rejected without losing the previous five', () => {
  const app = setup();
  app.add(Array.from({ length: 5 }, (_, index) => new File(['x'], `${index}.txt`)));
  app.add([new File(['x'], 'sixth.txt')]);
  assert.equal(app.payload().length, 5);
  assert.match(app.messages[0], /5/);
});

test('20 MB is allowed but exceeding it preserves the previous selection', () => {
  const app = setup();
  app.add([new File([new Uint8Array(20 * 1024 * 1024)], 'limit.bin')]);
  app.add([new File(['x'], 'extra.txt')]);
  assert.deepEqual(app.payload().map(file => file.name), ['limit.bin']);
  assert.match(app.messages[0], /20 MB/);
});

test('an empty selection preserves existing attachments; empty payload has no placeholder', () => {
  const app = setup();
  assert.equal(app.payload().length, 0);
  app.add([new File(['x'], 'a.txt')]);
  app.add([]);
  assert.deepEqual(app.payload().map(file => file.name), ['a.txt']);
});
