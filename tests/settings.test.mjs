import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');

async function load(saved, account) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', checked: false, dataset: {}, listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      setCustomValidity() {}, reportValidity() { return true; }
    });
    return nodes.get(selector);
  };
  const root = { dataset: {} };
  let stored = JSON.stringify(saved);
  runInNewContext(source, {
    document: { documentElement: root, querySelector: node, querySelectorAll: () => [] },
    location: { hash: '#/settings' },
    localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } },
    fetch: async (url, options) => {
      if (url === '/api/me') {
        return account ? { ok: true, json: async () => account } : { ok: false, status: 401 };
      }
      assert.equal(url, '/api/auth/logout');
      assert.equal(options.method, 'POST');
      return { ok: true };
    },
    window: { addEventListener() {}, matchMedia: () => ({ addEventListener() {} }) },
    setTimeout() {}, clearTimeout() {}
  });
  await new Promise(resolve => setImmediate(resolve));
  return { node, root, saved: () => JSON.parse(stored) };
}

test('authenticated accounts keep their theme and can save contrast without changing another profile', async () => {
  const account = { id: 'a', username: 'alice' };
  const app = await load({ activeId: 'b', profiles: [
    { id: 'a', name: 'Alice', theme: 'dark' },
    { id: 'b', name: 'Bob', theme: 'light', prefersColorContrast: false }
  ] }, account);
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.root.dataset.contrast, 'normal');
  app.node('#display-name').value = 'Alice';
  app.node('#color-contrast').checked = true;
  app.node('#settings-form').listeners.submit({ preventDefault() {} });
  assert.equal(app.root.dataset.contrast, 'high');
  assert.equal(app.saved().profiles[0].prefersColorContrast, true);
  assert.equal(app.saved().profiles[1].prefersColorContrast, false);
  const reloaded = await load(app.saved(), account);
  assert.equal(reloaded.root.dataset.contrast, 'high');
  await reloaded.node('#account').listeners.click();
  assert.equal(reloaded.root.dataset.contrast, 'normal');
  assert.equal(reloaded.root.dataset.theme, 'system');
  assert.equal(reloaded.saved().profiles[0].prefersColorContrast, true);
});

test('a saved local profile alone cannot sign the browser in', async () => {
  const app = await load({ activeId: 'a', profiles: [{ id: 'a', name: 'Alice', theme: 'dark' }] });
  assert.equal(app.node('#account').textContent, 'Sign in');
  assert.equal(app.root.dataset.theme, 'system');
});
