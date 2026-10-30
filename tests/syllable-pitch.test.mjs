import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/tests/SyllablePitch.js', import.meta.url), 'utf8');

test('pause preferences control correct and incorrect answers independently', () => {
  for (const correct of [true, false]) {
    for (const pause of [true, false]) {
      const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
      let scheduled = false;
      const preferences = { pauseAfterCorrect: correct ? pause : !pause, pauseAfterIncorrect: correct ? !pause : pause };
      const instance = runInNewContext(`${source}\nnew SyllablePitch(root, { preferences })`, {
        root, preferences, clearTimeout() {}, setTimeout() { scheduled = true; }
      });
      instance.state.started = true;
      instance.state.syllablePitch = { prompt: 'Fixture', pairs: [{ label: 'Low', category: 'Low' }, { label: 'High', category: 'High' }] };
      instance.state.pairIndex = 0;
      instance.selectIndex(correct ? 0 : 1);
      assert.equal(scheduled, !pause);
      assert.equal(root.innerHTML.includes('data-continue>'), pause);
    }
  }
});

test('review preferences show pitch graphs and inline audio only when enabled', () => {
  const review = runInNewContext(`${source}\nSyllablePitch.review`, {});
  const answer = { correct: false, selected: { label: 'High' }, pair: { label: 'Low', audio: '/low.wav', pitch: [0.2, 0.2] } };
  const inline = review(answer, { showPitchGraph: true, playAudioInline: true });
  assert.match(inline, /<svg/);
  assert.match(inline, /<audio controls/);
  assert.match(inline, /Your answer: High/);
  const buttons = review(answer, { showPitchGraph: false, playAudioInline: false });
  assert.doesNotMatch(buttons, /<svg|<audio/);
  assert.match(buttons, /data-replay/);
});

test('API failures show retry and a late response cannot restart an ended session', async () => {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const instance = runInNewContext(`${source}\nnew SyllablePitch(root)`, {
    root, AbortController, fetch: async () => ({ ok: false }), clearTimeout() {}, setTimeout() {}
  });
  await instance.start();
  assert.match(root.innerHTML, /data-retry/);
  assert.equal(instance.state.history.length, 0);
  let respond;
  const lateRoot = { ...root };
  const late = runInNewContext(`${source}\nnew SyllablePitch(root)`, {
    root: lateRoot, AbortController, fetch: () => new Promise(resolve => { respond = resolve; }), clearTimeout() {}, setTimeout() {}
  });
  const loading = late.start();
  late.finish('Ended');
  respond({ ok: true, json: async () => ({ pairs: [
    { label: 'Low', category: 'Low', audio: '/low.wav' }, { label: 'High', category: 'High', audio: '/high.wav' }
  ] }) });
  await loading;
  assert.equal(late.state.syllablePitch, null);
  assert.match(lateRoot.innerHTML, /Session ended/);
});

test('test loads from the new API and retains grading and continue behavior', () => {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  let pending;
  const instance = runInNewContext(`${source}\nnew SyllablePitch(root)`, {
    root, AbortController, fetch: () => new Promise(() => {}), setTimeout: fn => { pending = fn; return 1; }, clearTimeout: () => { pending = null; }
  });
  assert.match(root.innerHTML, /data-start/);
  instance.start();
  assert.match(root.innerHTML, /Loading exercise/);
  // Synthetic fixtures verify the preserved flow; these are not learning content.
  instance.state.syllablePitch = { prompt: 'Fixture', pairs: [
    { label: 'A', category: 'one' }, { label: 'B', category: 'two' }
  ] };
  instance.state.pairIndex = 0;
  instance.selectIndex(1);
  assert.equal(instance.state.history[0].correct, false);
  assert.match(root.innerHTML, /data-continue/);
  instance.selectIndex(0);
  assert.equal(instance.state.history.length, 1);
  instance.state.selectedIndex = null;
  instance.selectIndex(0);
  assert.equal(instance.state.history[0].correct, true);
  assert.equal(typeof pending, 'function');
  instance.destroy();
  assert.equal(pending, null);
});

test('limited sessions finish once at the question count and ignore further answers', () => {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const progress = [];
  const finishes = [];
  const instance = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
    root, AbortController, fetch: () => new Promise(() => {}), options: { limit: 1, tracked: true, onProgress: value => progress.push(value), onFinish: value => finishes.push(value) },
    clearTimeout() {}, setTimeout() { throw new Error('Completed sessions must not load another question'); }
  });
  instance.start();
  instance.state.syllablePitch = { prompt: 'Fixture', pairs: [{ label: 'A', category: 'one' }] };
  instance.state.pairIndex = 0;
  instance.selectIndex(0);
  instance.selectIndex(0);
  instance.destroy();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].answered, 1);
  assert.equal(progress[0].correct, 1);
  assert.deepEqual(finishes, ['Completed']);
  assert.match(root.innerHTML, /Session complete/);
});

test('unlimited sessions can end manually or be interrupted without double saving', () => {
  for (const manual of [true, false]) {
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    const finishes = [];
    const instance = runInNewContext(`${source}\nnew SyllablePitch(root, options)`, {
      root, AbortController, fetch: () => new Promise(() => {}), options: { limit: null, onFinish: value => finishes.push(value) }, clearTimeout() {}, setTimeout() {}
    });
    instance.start();
    if (manual) instance.finish('Ended');
    instance.destroy();
    instance.destroy();
    assert.deepEqual(finishes, [manual ? 'Ended' : 'Interrupted']);
  }
});
