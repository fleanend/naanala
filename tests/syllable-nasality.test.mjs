import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/tests/Exercise.js', import.meta.url), 'utf8') + '\n'
  + await readFile(new URL('../web/tests/SyllableNasality.js', import.meta.url), 'utf8');
const fixture = () => ({ example_id: '1', word: 'answer word', audio_id: 'abc123',
  syllables_no_nasals: ['first', 'second'], nasal_profile: ['O', 'N'],
  original_nasal_profile: ['O', 'N'], options_profile: [['O', 'N'], ['O', 'N']] });

test('nasality validates its contract and rejects pitch contours and mismatched arrays', () => {
  const Type = runInNewContext(`${source}\nSyllableNasality`, {});
  assert.equal(Type.validateExercise(fixture()).example_id, '1');
  assert.throws(() => Type.validateExercise({ ...fixture(), nasal_profile: ['H', 'N'] }), /options/);
  assert.throws(() => Type.validateExercise({ ...fixture(), syllables_no_nasals: ['one'] }), /counts/);
  assert.throws(() => Type.validateExercise({ ...fixture(), original_nasal_profile: ['O', 'H'] }), /original/);
});

test('nasality uses Oral/Nasal choices, whole-word scoring, queue retries, and its own review', async () => {
  const calls = [], progress = [];
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const ui = runInNewContext(`${source}\nnew SyllableNasality(root, options)`, {
    root, options: { limit: 2, preferences: { pauseAfterIncorrect: true }, onProgress: value => progress.push(value) },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ exercises: [fixture(), { ...fixture(), example_id: '2' }] }) };
    }
  });
  await ui.start();
  assert.deepEqual(calls, [{ url: '/api/tests/syllable-nasal/session', body: { question_count: 2 } }]);
  assert.match(root.innerHTML, />Oral<|>Nasal</);
  assert.doesNotMatch(root.innerHTML, /answer word|contour for/);
  ui.choose(0, 'O'); ui.submit();
  assert.equal(progress.length, 0);
  ui.choose(1, 'O'); ui.submit();
  assert.equal(progress[0].correct, 0);
  assert.match(root.innerHTML, /Your nasality: Oral/);
  assert.match(root.innerHTML, /Correct nasality: Nasal/);
  await ui.load();
  assert.equal(ui.state.exercise.example_id, '2');
  await ui.load(); // Retry keeps the same unanswered row.
  assert.equal(ui.state.exercise.example_id, '2');
  assert.equal(calls.length, 1);
  ui.choose(0, 'O'); ui.choose(1, 'N'); ui.submit();
  assert.equal(ui.finishStatus, 'Completed');
  assert.equal(progress[1].correct, 1);
  ui.destroy();
});
