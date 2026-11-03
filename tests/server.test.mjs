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
    for (const path of ['/', '/index.html', '/app.js', '/style.css', '/tests/SyllablePitch.js', '/tests/VowelLength.js', '/tests/Tests.js', '/docs']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      if (path !== '/docs') assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/reference/legacy/Package.swift', '/backend/app.py', '/requirements.txt', '/api/me', '/missing', '/%2e%2e/package.json', '/api/audio/dummy/unknown.wav']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const exercise = (await (await fetch(base + '/api/tests/syllable-pitch/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_count: 1 }) })).json()).exercises[0];
    const frontendSource = await readFile(new URL('../web/tests/Exercise.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
    const validate = runInNewContext(`${frontendSource}\nSyllablePitch.validateExercise`, {});
    const keys = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
    for (let mask = 0; mask < 64; mask++) {
      const settings = Object.fromEntries(keys.map((key, i) => [key, !!(mask & (1 << i))]));
      const response = await fetch(base + '/api/tests/syllable-pitch/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, question_count: 1 })
      });
      if (response.status === 503) continue;
      assert.equal(response.status, 200, JSON.stringify({ ...settings, question_count: 1 }));
      const item = (await response.json()).exercises[0];
      assert.doesNotThrow(() => validate(item), JSON.stringify({ ...settings, question_count: 1 }));
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
      const response = await fetch(base + '/api/tests/syllable-pitch/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, question_count: 1 })
      });
      assert.equal(response.status, 200);
      assert.equal(typeof (await response.json()).exercises[0].audio_id, 'string');
    }
    const sessionRequest = body => fetch(base + '/api/tests/syllable-pitch/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const fullSession = await (await sessionRequest({})).json();
    assert.ok(fullSession.available_count > 0);
    assert.equal(fullSession.exercises.length, fullSession.available_count);
    assert.equal(new Set(fullSession.exercises.map(item => item.example_id)).size, fullSession.available_count);
    fullSession.exercises.forEach(item => assert.doesNotThrow(() => validate(item)));
    const capped = await (await sessionRequest({ question_count: 1000 })).json();
    assert.equal(capped.exercises.length, Math.min(1000, fullSession.available_count));
    const filtered = await (await sessionRequest({ question_count: 5, monophthongs: false, diphthongs_long_vowels: false })).json();
    assert.ok(filtered.exercises.length <= 5);
    filtered.exercises.forEach(item => item.tone_profile.forEach(tone => assert.ok(tone === 'P' || tone.length === 3)));
    assert.equal((await sessionRequest(Object.fromEntries(keys.map(key => [key, false])))).status, 503);
    for (const question_count of [0, -1, 1001, 1.5]) assert.equal((await sessionRequest({ question_count })).status, 422);
    const schema = await (await fetch(base + '/openapi.json')).json();
    const settingsSchema = schema.components.schemas.PitchSyllableSettings;
    assert.equal((await fetch(base + '/api/tests/syllable-pitch/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monophthongs: false })
    })).status, 200);
    for (const key of ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending']) {
      assert.equal(settingsSchema.properties[key].type, 'boolean');
      assert.equal(settingsSchema.properties[key].default, true);
    }
    assert.equal((await fetch(base + '/api/tests/syllable-pitch/session', {
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
    const source = await readFile(new URL('../web/tests/Exercise.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    let status;
    const exerciseUI = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
      root, options: { limit: 1, onFinish: value => { status = value; } },
      AbortController, fetch: (url, options) => fetch(base + url, options), setTimeout, clearTimeout
    });
    await exerciseUI.start();
    assert.equal(typeof exerciseUI.state.exercise.word, 'string');
    assert.match(root.innerHTML, /name="syllable-0"/);
    assert.equal(exerciseUI.state.history.length, 0);
    assert.equal(status, undefined);
    exerciseUI.state.exercise.tone_profile.forEach((tone, i) => exerciseUI.choose(i, tone));
    exerciseUI.submit();
    assert.equal(status, 'Completed');
    assert.equal(exerciseUI.state.history[0].correct, true);
    exerciseUI.destroy();
    // Both subclasses run through the same lifecycle against their real API contracts.
    const nasalSource = await readFile(new URL('../web/tests/SyllableNasality.js', import.meta.url), 'utf8');
    const nasalBatchResponse = await fetch(base + '/api/tests/syllable-nasal/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_count: 5 })
    });
    assert.equal(nasalBatchResponse.status, 200);
    const nasalBatch = await nasalBatchResponse.json();
    assert.ok(nasalBatch.exercises.length > 0);
    assert.equal(new Set(nasalBatch.exercises.map(item => item.example_id)).size, nasalBatch.exercises.length);
    const Nasality = runInNewContext(`${source}\n${nasalSource}\nSyllableNasality`, {});
    nasalBatch.exercises.forEach(item => assert.doesNotThrow(() => Nasality.validateExercise(item)));
    let nasalStatus;
    const nasalUI = runInNewContext(`${source}\n${nasalSource}\nnew SyllableNasality(root, options)`, {
      root, options: { limit: 1, onFinish: value => { nasalStatus = value; } },
      AbortController, fetch: (url, options) => fetch(base + url, options), setTimeout, clearTimeout
    });
    await nasalUI.start();
    assert.equal(nasalUI.state.error, null);
    nasalUI.state.exercise.nasal_profile.forEach((choice, i) => nasalUI.choose(i, choice));
    nasalUI.submit();
    assert.equal(nasalStatus, 'Completed');
    assert.equal(nasalUI.state.history[0].correct, true);
    assert.match(root.innerHTML, /Correct nasality:/);
    assert.doesNotMatch(root.innerHTML, /Correct contour:/);
    nasalUI.destroy();
    const lengthSource = await readFile(new URL('../web/tests/VowelLength.js', import.meta.url), 'utf8');
    const Length = runInNewContext(`${source}\n${lengthSource}\nVowelLength`, {});
    const contrastKeys = Object.keys(Length.contrasts);
    const lengthRequest = body => fetch(base + '/api/tests/vowel-length/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const vowelInfo = spelling => {
      const decomposed = spelling.normalize('NFD');
      const clusters = [...decomposed.matchAll(/[aeiou][\u0300-\u036f]*/g)].map(match => match[0]);
      return {
        nucleus: clusters.map(cluster => cluster[0]).join(''),
        consonants: decomposed.replace(/[aeiou][\u0300-\u036f]*/g, ''),
        tone: clusters.map(cluster => cluster.includes('\u0301') ? 'H' : 'L').join('').replace(/(.)\1+/g, '$1'),
        nasal: clusters.every(cluster => cluster.includes('\u0328')),
        oral: clusters.every(cluster => !cluster.includes('\u0328'))
      };
    };
    for (const contrast of contrastKeys) {
      const response = await lengthRequest(Object.fromEntries(contrastKeys.map(key => [key, key === contrast])));
      assert.equal(response.status, 200, contrast);
      const batch = await response.json();
      assert.ok(batch.exercises.length > 0, contrast);
      assert.equal(new Set(batch.exercises.map(item => item.example_id)).size, batch.exercises.length);
      let sawHigh = false, sawNasal = false;
      for (const item of batch.exercises) {
        Length.validateExercise(item);
        item.length_profile.forEach((answer, i) => {
          if (answer === 'P') return;
          assert.equal(item.contrast_profile[i], contrast);
          const options = item.options_profile[i];
          assert.equal(options.length, 2);
          assert.ok(options.includes(answer));
          const [a, b] = options.map(vowelInfo).sort((a, b) => a.nucleus.length - b.nucleus.length);
          assert.equal(a.consonants, b.consonants);
          assert.equal(a.tone, b.tone);
          assert.equal(a.nasal, b.nasal);
          assert.equal(a.oral, b.oral);
          assert.ok(a.nasal || a.oral);
          assert.equal(a.nucleus[0], b.nucleus[0]);
          if (contrast === 'short_long') { assert.equal(a.nucleus.length, 1); assert.equal(b.nucleus, a.nucleus.repeat(2)); }
          if (contrast === 'short_diphthong') { assert.equal(a.nucleus.length, 1); assert.equal(b.nucleus.length, 2); assert.notEqual(b.nucleus[0], b.nucleus[1]); }
          if (contrast === 'long_diphthong') { assert.equal(a.nucleus.length, 2); assert.equal(b.nucleus.length, 2); assert.ok((a.nucleus[0] === a.nucleus[1]) !== (b.nucleus[0] === b.nucleus[1])); }
          if (contrast === 'diphthong_long_final') { assert.equal(a.nucleus.length, 2); assert.notEqual(a.nucleus[0], a.nucleus[1]); assert.equal(b.nucleus, a.nucleus + a.nucleus[1]); }
          assert.match(item.syllables_length_prompt[i], /\*/);
          assert.doesNotMatch(item.syllables_length_prompt[i], /tone;|\[vowel\]/);
          assert.equal(vowelInfo(item.syllables_length_prompt[i]).nucleus, a.nucleus[0]);
          sawHigh ||= a.tone.includes('H'); sawNasal ||= a.nasal;
        });
      }
      if (contrast === 'short_long') { assert.ok(sawHigh); assert.ok(sawNasal); }
    }
    assert.equal((await lengthRequest(Object.fromEntries(contrastKeys.map(key => [key, false])))).status, 503);
    assert.equal((await lengthRequest({ question_count: 0 })).status, 422);
    let lengthStatus;
    const lengthUI = runInNewContext(`${source}\n${lengthSource}\nnew VowelLength(root, options)`, {
      root, options: { limit: 1, onFinish: value => { lengthStatus = value; } },
      AbortController, fetch: (url, options) => fetch(base + url, options), setTimeout, clearTimeout
    });
    await lengthUI.start();
    assert.equal(lengthUI.state.error, null);
    lengthUI.state.exercise.length_profile.forEach((choice, i) => lengthUI.choose(i, choice));
    lengthUI.submit();
    assert.equal(lengthStatus, 'Completed');
    assert.equal(lengthUI.state.history[0].correct, true);
    assert.match(root.innerHTML, /Correct vowel form:/);
    lengthUI.destroy();
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    server.kill();
    await closed;
  }
});
