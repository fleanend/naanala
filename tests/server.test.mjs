import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startBackend } from '../server.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('Python backend serves frontend, dummy exercises and playable audio', async () => {
  const server = startBackend({ port: 0, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const closed = once(server, 'exit');
  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Backend startup timed out: ${output}`)), 15000);
      const fail = error => { clearTimeout(timeout); reject(error); };
      server.once('error', fail);
      server.once('exit', code => fail(new Error(`Backend exited (${code}): ${output}`)));
      const capture = chunk => {
        output += chunk.toString();
        const match = output.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      };
      server.stdout.on('data', capture);
      server.stderr.on('data', capture);
    });
    for (const path of ['/', '/index.html', '/app.js', '/style.css', '/tests/SyllablePitch.js', '/tests/Tests.js', '/docs']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/reference/legacy/Package.swift', '/backend/app.py', '/requirements.txt', '/api/me', '/missing', '/%2e%2e/package.json', '/api/audio/dummy/unknown.wav']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const exercise = await (await fetch(base + '/api/tests/syllable-pitch/random')).json();
    assert.equal(exercise.dummy, true);
    assert.equal(exercise.pairs.length, 2);
    const sounds = [];
    for (const pair of exercise.pairs) {
      const response = await fetch(base + pair.audio);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /audio\/wav/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      assert.equal(bytes.readUInt32LE(24), 22050);
      assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
      sounds.push(bytes);
    }
    assert.notDeepEqual(sounds[0], sounds[1]);
    // Exercise the actual browser loader against the running API, then complete a session.
    const source = await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    let status;
    const exerciseUI = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
      root, options: { limit: 1, onFinish: value => { status = value; } },
      AbortController, fetch: (url, options) => fetch(base + url, options), setTimeout, clearTimeout
    });
    await exerciseUI.start();
    assert.equal(exerciseUI.state.syllablePitch.pairs.length, 2);
    assert.match(root.innerHTML, /Low pitch/);
    exerciseUI.selectIndex(exerciseUI.state.pairIndex);
    assert.equal(status, 'Completed');
    assert.equal(exerciseUI.state.history[0].correct, true);
    exerciseUI.destroy();
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    server.kill();
    await closed;
  }
});
