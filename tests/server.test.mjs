import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startBackend } from '../server.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('Python backend serves exercises and recordings by ID with complete scoring flow', async () => {
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
      if (path !== '/docs') assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/reference/legacy/Package.swift', '/backend/app.py', '/requirements.txt', '/api/me', '/missing', '/%2e%2e/package.json', '/api/audio/dummy/unknown.wav']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const exercise = await (await fetch(base + '/api/tests/syllable-pitch/random')).json();
    const frontendSource = await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
    const validate = runInNewContext(`${frontendSource}\nSyllablePitch.validateExercise`, {});
    const keys = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
    for (let mask = 0; mask < 64; mask++) {
      const settings = Object.fromEntries(keys.map((key, i) => [key, !!(mask & (1 << i))]));
      const response = await fetch(base + '/api/tests/syllable-pitch/random', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
      });
      if (response.status === 503) continue;
      assert.equal(response.status, 200, JSON.stringify(settings));
      const item = await response.json();
      assert.doesNotThrow(() => validate(item), JSON.stringify(settings));
      assert.equal(item.options_profile.length, item.tone_profile.length);
      assert.equal(item.syllables_no_pitch.length, item.tone_profile.length);
      assert.ok(item.tone_profile.some(tone => tone !== 'P'));
      const enabled = tone => settings[keys[tone.length - 1]] && settings[/^H+$|^L+$/.test(tone) ? 'flat' : tone.startsWith('L') ? 'rising' : 'descending'];
      item.tone_profile.forEach((tone, i) => {
        if (tone === 'P') assert.deepEqual(item.options_profile[i], []);
        else {
          assert.ok(enabled(tone));
          assert.ok(item.options_profile[i].includes(tone));
          assert.ok(item.options_profile[i].every(enabled));
        }
      });
    }
    for (const settings of [{ monophthongs: true, diphthongs_long_vowels: false, triphthongs_diphthongs_with_long_vowels: false, flat: true, rising: true, descending: false }, {}]) {
      const response = await fetch(base + '/api/tests/syllable-pitch/random', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
      });
      assert.equal(response.status, 200);
      assert.equal(typeof (await response.json()).audio_id, 'string');
    }
    const schema = await (await fetch(base + '/openapi.json')).json();
    const settingsSchema = schema.components.schemas.PitchSyllableSettings;
    assert.equal((await fetch(base + '/api/tests/syllable-pitch/random', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monophthongs: false })
    })).status, 200);
    for (const key of ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending']) {
      assert.equal(settingsSchema.properties[key].type, 'boolean');
      assert.equal(settingsSchema.properties[key].default, true);
    }
    assert.equal((await fetch(base + '/api/tests/syllable-pitch/random', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rising: 'invalid' })
    })).status, 422);
    assert.equal(typeof exercise.word, 'string');
    assert.equal(typeof exercise.audio_id, 'string');
    assert.equal(exercise.audio_file, undefined);
    const recording = await fetch(base + '/api/audio/' + exercise.audio_id);
    assert.equal(recording.status, 200);
    assert.match(recording.headers.get('content-type'), /audio\/ogg/);
    const ogg = Buffer.from(await recording.arrayBuffer());
    assert.equal(ogg.toString('ascii', 0, 4), 'OggS');
    const range = await fetch(base + '/api/audio/' + exercise.audio_id, { headers: { Range: 'bytes=0-3' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), 'OggS');
    assert.equal((await fetch(base + '/api/audio/unknown-recording')).status, 404);
    assert.equal((await fetch(base + '/api/audio/%2e%2e%2fapp.py')).status, 404);
    assert.ok(exercise.syllables_no_pitch.every(item => typeof item === 'string'));
    assert.ok(exercise.tone_profile.every(item => typeof item === 'string'));
    assert.ok(exercise.options_profile.every(list => Array.isArray(list) && list.every(item => typeof item === 'string')));
    // Exercise actual syllable selection and whole-word scoring against the API.
    const source = await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    let status;
    const exerciseUI = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
      root, options: { limit: 1, onFinish: value => { status = value; } },
      AbortController, fetch: (url, options) => fetch(base + url, options), setTimeout, clearTimeout
    });
    await exerciseUI.start();
    assert.equal(typeof exerciseUI.state.syllablePitch.word, 'string');
    assert.match(root.innerHTML, /name="syllable-0"/);
    assert.equal(exerciseUI.state.history.length, 0);
    assert.equal(status, undefined);
    exerciseUI.state.syllablePitch.tone_profile.forEach((tone, i) => exerciseUI.choose(i, tone));
    exerciseUI.submit();
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
