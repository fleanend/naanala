import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/tests/Exercise.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');
const fixture = () => ({ example_id: 'row-1', syllables_no_pitch: ['man', 'gii'], tone_profile: ['L', 'HL'], options_profile: [['H', 'L'], ['HH', 'LL', 'LH', 'HL']], word: 'test word', audio_id: 'abc123' });
const batch = exercise => ({ exercises: [exercise, { ...exercise, example_id: 'row-2' }, { ...exercise, example_id: 'row-3' }] });

test('disabled syllables stay visible but require no answer and do not affect scoring or review', async () => {
  const exercise = { ...fixture(), tone_profile: ['P', 'HL'], original_tone_profile: ['L', 'HL'], options_profile: [[], ['LH', 'HL']] };
  const { ui, root } = create({ limit: 1 }, { fetch: async () => ({ ok: true, json: async () => batch(exercise) }) });
  await ui.start();
  assert.equal(ui.state.error, null);
  assert.match(root.innerHTML, /Correct contour: L/);
  assert.doesNotMatch(root.innerHTML, /name="syllable-0"/);
  assert.match(root.innerHTML, /name="syllable-1"/);
  ui.choose(0, 'L');
  assert.equal(ui.state.choices[0], 'P');
  ui.submit();
  assert.equal(ui.state.history.length, 0);
  ui.choose(1, 'HL');
  ui.submit();
  assert.equal(ui.state.history[0].correct, true);
  assert.equal(ui.state.history[0].syllables[0].skipped, true);
  assert.equal(ui.state.history[0].syllables[0].expected, 'L');
  assert.match(root.innerHTML, /man: Skipped/);
  assert.doesNotMatch(root.innerHTML, /P pitch contour/);
  const validate = runInNewContext(`${source}\nSyllablePitch.validateExercise`, {});
  assert.throws(() => validate({ ...exercise, tone_profile: ['P', 'P'] }), /No enabled/);
});
test('session requests send categories once and subsequent questions use the queue', async () => {
  const calls = [];
  const { ui } = create({ profiles: ['rising'] }, { fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => batch(fixture()) };
  } });
  await ui.start();
  await ui.load();
  assert.equal(calls.length, 1);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), {
      monophthongs: false, diphthongs_long_vowels: false,
      triphthongs_diphthongs_with_long_vowels: false,
      flat: false, rising: true, descending: false, question_count: null
    });
  }
  ui.destroy();
});
test('display smoothing reduces jitter and connects dropouts without changing measurements', () => {
  const Pitch = runInNewContext(`${source}\nSyllablePitch`, {});
  const points = [150, 152, 180, 151, 150, null, 250, 252, 250].map((hz, i) => ({ time: i * .01, hz }));
  const before = JSON.stringify(points);
  const smoothed = Pitch.smoothPitch(points);
  assert.ok(smoothed[2].hz < 170);
  assert.equal(smoothed[5].hz, null);
  assert.equal(smoothed[4].hz, 150);
  assert.equal(smoothed[6].hz, 250);
  assert.equal(JSON.stringify(points), before);
  const markup = Pitch.frequencyMarkup({ duration: .1, points });
  const curve = markup.match(/<path d="([^"]*)" fill="none"/)[1];
  assert.equal((curve.match(/M/g) || []).length, 1);
  assert.match(curve, /C/);
  assert.doesNotMatch(curve, /NaN|Infinity/);
});
test('frequency axis fits each recording and handles constant pitch', () => {
  const Pitch = runInNewContext(`${source}\nSyllablePitch`, {});
  const graph = values => Pitch.frequencyMarkup({ duration: 1, points: values.map((hz, i) => ({ time: .2 + i * .1, hz })) });
  const ticks = markup => [...markup.matchAll(/font-size="12">(\d+)<\/text>/g)].map(match => Number(match[1]));
  assert.deepEqual(ticks(graph([100, 150])), [95, 125, 155]);
  assert.deepEqual(ticks(graph([300, 400])), [290, 350, 410]);
  const flat = graph([200, 200]);
  assert.deepEqual(ticks(flat), [195, 200, 205]);
  assert.doesNotMatch(flat, /NaN|Infinity/);
});

test('curve extends to both recording edges without inventing pitch for an entirely unvoiced track', () => {
  const Pitch = runInNewContext(`${source}\nSyllablePitch`, {});
  const track = { duration: 1.4, points: [{ time: .5, hz: 100 }, { time: .9, hz: 150 }] };
  const before = JSON.stringify(track);
  const curve = Pitch.frequencyMarkup(track).match(/<path d="([^"]*)" fill="none"/)[1];
  assert.match(curve, /^M50 140 /);
  assert.match(curve, /620 [\d.]+ $/);
  assert.equal(JSON.stringify(track), before);
  assert.match(Pitch.frequencyMarkup({ duration: 1, points: [{ time: .5, hz: null }] }), /No reliable/);
});
function create(options = {}, overrides = {}) {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const ui = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
    root, options, AbortController, fetch: async () => ({ ok: true, json: async () => batch(fixture()) }), setTimeout, clearTimeout, ...overrides
  });
  return { ui, root };
}

test('actual response validation checks all fields, matching counts and correct contour options', () => {
  const validate = runInNewContext(`${source}\nSyllablePitch.validateExercise`, {});
  assert.equal(validate(fixture()).audio_id, 'abc123');
  for (const field of Object.keys(fixture())) {
    const missing = fixture(); delete missing[field];
    assert.throws(() => validate(missing), new RegExp(field));
    assert.throws(() => validate({ ...fixture(), [field]: 123 }), new RegExp(field));
  }
  assert.throws(() => validate({ ...fixture(), audio_id: '../private' }), /audio_id/);
  assert.throws(() => validate({ ...fixture(), tone_profile: ['L'] }), /counts/);
  assert.throws(() => validate({ ...fixture(), options_profile: [['H'], ['HL']] }), /options/);
  assert.throws(() => validate({ ...fixture(), options_profile: ['L', 'HL'] }), /options_profile/);
});

test('loads one contour choice group per syllable, hides accented word until review, escapes labels', async () => {
  const exercise = { ...fixture(), syllables_no_pitch: ['<script>bad()</script>', 'gii'] };
  const { ui, root } = create({}, { fetch: async () => ({ ok: true, json: async () => batch(exercise) }) });
  await ui.start();
  assert.match(root.innerHTML, /name="syllable-0"/);
  assert.match(root.innerHTML, /name="syllable-1"/);
  assert.match(root.innerHTML, /\/api\/audio\/abc123/);
  assert.match(root.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(root.innerHTML, /<script>|test word/);
  assert.equal(ui.state.history.length, 0);
  ui.destroy();
});

test('requires every choice, reports per-syllable correctness, scores once per whole word', async () => {
  const progress = [];
  const { ui, root } = create({ preferences: { pauseAfterIncorrect: true }, onProgress: result => progress.push(result) });
  await ui.start();
  ui.choose(0, 'L'); ui.submit();
  assert.equal(progress.length, 0);
  ui.choose(1, 'HH'); ui.submit(); ui.submit();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].answered, 1);
  assert.equal(progress[0].correct, 0);
  assert.deepEqual(Array.from(progress[0].answer.syllables, item => item.correct), [true, false]);
  assert.match(root.innerHTML, /Your contour: HH/);
  assert.match(root.innerHTML, /Correct contour: HL/);
  ui.choose(1, 'HL');
  assert.equal(ui.state.choices[1], 'HH');
  ui.destroy();
});

test('all syllables correct completes limited session and saves review', async () => {
  const statuses = [];
  const { ui, root } = create({ limit: 1, onFinish: status => statuses.push(status) });
  await ui.start();
  ui.choose(0, 'L'); ui.choose(1, 'HL'); ui.submit(); ui.submit(); ui.destroy();
  assert.equal(ui.state.history[0].correct, true);
  assert.deepEqual(statuses, ['Completed']);
  assert.match(root.innerHTML, /Session complete/);
  assert.match(root.innerHTML, /test word/);
});

test('correct and incorrect pause preferences control automatic advance independently', async () => {
  for (const correct of [true, false]) for (const pause of [true, false]) {
    let scheduled = false;
    const { ui } = create({ preferences: { pauseAfterCorrect: correct ? pause : !pause, pauseAfterIncorrect: correct ? !pause : pause } }, { setTimeout() { scheduled = true; }, clearTimeout() {} });
    await ui.start();
    ui.choose(0, 'L'); ui.choose(1, correct ? 'HL' : 'HH'); ui.submit();
    assert.equal(scheduled, !pause);
    ui.destroy();
  }
});

test('review includes annotated contours and audio but hides the estimated frequency graph', async () => {
  const { ui } = create({ limit: 1 });
  await ui.start();
  ui.state.recordingAnalysis = { duration: 1, points: [{time: .1, hz: 150}, {time: .2, hz: null}, {time: .3, hz: 180}] };
  ui.choose(0, 'L'); ui.choose(1, 'HL'); ui.submit();
  const review = runInNewContext(`${source}\nSyllablePitch.review`, {});
  const inline = review(ui.state.history[0], { showPitchGraph: true, playAudioInline: true });
  assert.match(inline, /HL pitch contour/);
  assert.doesNotMatch(inline, /Pitch frequency|data-frequency-chart/);
  assert.match(inline, /<audio controls/);
  const button = review(ui.state.history[0], { showPitchGraph: false, playAudioInline: false });
  assert.doesNotMatch(button, /pitch contour|data-review-play/);
  assert.match(button, /<audio controls/);
});

test('pitch decoding uses actual audio samples and closes its audio context', async () => {
  let closed = false;
  const requests = [];
  const { ui } = create({}, {
    AudioContext: class {
      async decodeAudioData() { return { sampleRate: 8000, length: 8000, numberOfChannels: 1, getChannelData: () => Float32Array.from({length:8000}, (_, i) => .5 * Math.sin(2 * Math.PI * 200 * i / 8000)) }; }
      async close() { closed = true; }
    },
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => batch(fixture()), arrayBuffer: async () => new ArrayBuffer(4) };
    }
  });
  await ui.start();
  assert.deepEqual(requests, ['/api/tests/syllable-pitch/session', '/api/audio/abc123']);
  assert.ok(ui.state.recordingAnalysis.points.filter(p => p.hz).every(p => Math.abs(p.hz - 200) < 3));
  assert.ok(ui.state.recordingAnalysis.points.some(p => p.hz));
  assert.doesNotMatch(ui.root.innerHTML, /Pitch frequency/);
  ui.choose(0, 'L'); ui.choose(1, 'HL'); ui.submit();
  assert.doesNotMatch(ui.root.innerHTML, /Pitch frequency|data-frequency-chart/);
  assert.equal(closed, true);
  ui.destroy();
});

test('request failures offer retry and late responses cannot restart an ended session', async () => {
  const failed = create({}, { fetch: async () => ({ ok: false, status: 500 }) });
  await failed.ui.start();
  assert.match(failed.root.innerHTML, /data-retry/);
  failed.ui.destroy();
  let respond;
  const { ui, root } = create({}, { fetch: () => new Promise(resolve => { respond = resolve; }) });
  const loading = ui.start();
  ui.finish('Ended');
  respond({ ok: true, json: async () => batch(fixture()) });
  await loading;
  assert.equal(ui.state.exercise, null);
  assert.match(root.innerHTML, /Session ended/);
});

test('unlimited session ends or interrupts exactly once', async () => {
  for (const manual of [true, false]) {
    const statuses = [];
    const { ui } = create({ onFinish: status => statuses.push(status) });
    await ui.start();
    if (manual) ui.finish('Ended');
    ui.destroy(); ui.destroy();
    assert.deepEqual(statuses, [manual ? 'Ended' : 'Interrupted']);
  }
});


test('frequency estimation leaves silence unvoiced and follows a rising pitch', () => {
  const estimate = runInNewContext(`${source}\nSyllablePitch.estimatePitch`, {});
  const rate = 8000;
  const quiet = { sampleRate: rate, length: rate, numberOfChannels: 1, getChannelData: () => new Float32Array(rate) };
  assert.ok(estimate(quiet).points.every(point => point.hz === null));
  const samples = new Float32Array(rate);
  let phase = 0;
  for (let i = 0; i < rate; i++) { phase += 2 * Math.PI * (120 + i / rate * 120) / rate; samples[i] = .5 * Math.sin(phase); }
  const track = estimate({ ...quiet, getChannelData: () => samples });
  const voiced = track.points.filter(point => point.hz !== null);
  assert.ok(voiced.length > 20);
  assert.ok(voiced.at(-1).hz > voiced[0].hz + 80);
});

test('review playhead follows playback and seeking, and cleanup stops animation', () => {
  const element = () => ({ listeners: {}, attrs: {}, value: '', textContent: '',
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    removeEventListener(event, fn) { this.listeners[event] = this.listeners[event].filter(item => item !== fn); },
    emit(event, value = {}) { (this.listeners[event] || []).slice().forEach(fn => fn(value)); },
    setAttribute(key, value) { this.attrs[key] = Number(value); }
  });
  const nodes = new Map();
  for (const selector of ['audio', '[data-frequency-duration]', '[data-frequency-chart]', '[data-frequency-seek]', '[data-playhead]', '[data-played-region]', '[data-frequency-time]', '[data-review-play]']) nodes.set(selector, element());
  const audio = nodes.get('audio');
  Object.assign(audio, { duration: 2, currentTime: 0, paused: true, ended: false,
    play() { this.paused = false; this.emit('play'); return Promise.resolve(); },
    pause() { this.paused = true; this.emit('pause'); }
  });
  nodes.get('[data-frequency-duration]').dataset = { frequencyDuration: '2' };
  nodes.get('[data-frequency-chart]').getBoundingClientRect = () => ({ left: 0, width: 640 });
  const review = { querySelector: selector => nodes.get(selector) };
  const root = { querySelectorAll: selector => selector === 'audio' ? [audio] : [review] };
  let animation, cancelled = 0;
  const bind = runInNewContext(`${source}\nSyllablePitch.bindReviewMedia`, {
    requestAnimationFrame(fn) { animation = fn; return 1; }, cancelAnimationFrame() { cancelled++; }
  });
  const cleanup = bind(root);
  audio.play(); audio.currentTime = 1; animation();
  assert.equal(nodes.get('[data-playhead]').attrs.x1, 335);
  assert.equal(nodes.get('[data-frequency-time]').textContent, '1.00 / 2.00 s');
  nodes.get('[data-frequency-chart]').emit('click', { clientX: 620 });
  assert.equal(audio.currentTime, 2);
  nodes.get('[data-frequency-seek]').value = '.5';
  nodes.get('[data-frequency-seek]').emit('input');
  assert.equal(audio.currentTime, .5);
  audio.pause();
  assert.ok(cancelled > 0);
  cleanup();
  assert.equal(audio.listeners.play.length, 0);
  assert.equal(audio.paused, true);
});

test('quiet speech-like periodic audio is tracked while noise and pauses remain gaps', () => {
  const estimate = runInNewContext(`${source}\nSyllablePitch.estimatePitch`, {});
  const rate = 8000;
  let seed = 12345;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - .5; };
  const samples = Float32Array.from({ length: rate * 2 }, (_, i) => {
    if (i >= rate * .6 && i < rate * 1.2) return 0;
    const phase = 2 * Math.PI * 170 * i / rate;
    return .002 * (Math.sin(phase) + .35 * Math.sin(phase * 2)) + noise() * .0006;
  });
  const buffer = { sampleRate: rate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
  const track = estimate(buffer);
  const speech = track.points.filter(point => point.time < .5 || point.time > 1.3);
  assert.ok(speech.filter(point => point.hz !== null && Math.abs(point.hz - 170) < 8).length / speech.length > .9);
  assert.ok(track.points.filter(point => point.time > .7 && point.time < 1.1).every(point => point.hz === null));
  const noiseSamples = Float32Array.from({ length: rate }, () => noise() * .1);
  const noiseTrack = estimate({ ...buffer, length: rate, getChannelData: () => noiseSamples });
  assert.ok(noiseTrack.points.filter(point => point.hz !== null).length / noiseTrack.points.length < .05);
});



test('limited sessions cap at available rows and keep distinct rows of the same word', async () => {
  let ready;
  const { ui, root } = create({ limit: 20, onSessionReady: value => { ready = value.limit; }, preferences: { pauseAfterCorrect: true } });
  await ui.start();
  assert.equal(ready, 3);
  assert.match(root.innerHTML, /Only 3 examples/);
  for (let i = 0; i < 3; i++) {
    assert.equal(ui.state.exercise.example_id, `row-${i + 1}`);
    ui.choose(0, 'L'); ui.choose(1, 'HL'); ui.submit();
    if (i < 2) await ui.load();
  }
  assert.equal(ui.finishStatus, 'Completed');
  assert.equal(new Set(ui.state.history.map(item => item.example_id)).size, 3);
});

test('unlimited sessions exhaust the queue before requesting a new shuffled pass', async () => {
  let calls = 0;
  const { ui } = create({ preferences: { pauseAfterCorrect: true } }, { fetch: async () => {
    calls++;
    return { ok: true, json: async () => batch(fixture()) };
  } });
  await ui.start();
  for (let i = 0; i < 3; i++) {
    assert.equal(calls, 1);
    ui.choose(0, 'L'); ui.choose(1, 'HL'); ui.submit();
    await ui.load();
  }
  assert.equal(calls, 2);
  assert.equal(ui.finished, false);
  ui.destroy();
});
