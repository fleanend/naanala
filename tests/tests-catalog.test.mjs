import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const lengthSource = await readFile(new URL('../web/tests/Exercise.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../web/tests/VowelLength.js', import.meta.url), 'utf8');
const lengthContrasts = runInNewContext(`${lengthSource}\nVowelLength.contrasts`, {});
const source = await readFile(new URL('../web/tests/Tests.js', import.meta.url), 'utf8');
function load(path, user) {
  const nodes = new Map();
  const root = { innerHTML: '', querySelectorAll(selector) {
    if (selector === '[data-pitch-profile]') return ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'].map(profile => {
      const node = this.querySelector(`[data-pitch-profile="${profile}"]`);
      node.dataset = { pitchProfile: profile };
      return node;
    });
    if (selector === '[data-length-contrast]') return Object.keys(lengthContrasts).map(key => {
      const node = this.querySelector(`[data-length-contrast="${key}"]`);
      node.dataset = { lengthContrast: key };
      node.checked = root.innerHTML.includes(`data-length-contrast="${key}" checked`);
      return node;
    });
    if (selector === '[data-preference]') return ['pauseAfterCorrect', 'pauseAfterIncorrect', 'showPitchGraph'].map(key => {
      const node = this.querySelector(`[data-preference="${key}"]`);
      node.dataset = { preference: key };
      return node;
    });
    return [];
  }, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return nodes.get(selector);
  } };
  let saved = 0;
  class SyllablePitch {
    static bindReviewMedia() { return () => {}; }
    static review() { return '<p>Answer review fixture</p>'; }
    constructor(_, options) { this.options = options; }
    start() { this.started = true; }
    destroy() {}
  }
  class VowelLength extends SyllablePitch { static contrasts = lengthContrasts; }
  const instance = runInNewContext(`${source}\nnew Tests(root, context)`, {
    root, context: { path, user, persist: () => { saved++; }, signIn() {} }, SyllablePitch, SyllableNasality: SyllablePitch, Exercise: SyllablePitch, VowelLength
  });
  return { instance, root, saved: () => saved };
}

test('pitch profiles default on, save immediately per user, and reach the session', () => {
  const user = {};
  const app = load('/tests/syllable-pitch', user);
  assert.equal(app.instance.pitchProfiles.length, 6);
  assert.match(app.root.innerHTML, /data-pitch-profile="monophthongs"/);
  const old = load('/tests/syllable-pitch', { exerciseSettings: { 'syllable-pitch': { profiles: [] } } });
  assert.equal(old.instance.pitchProfiles.includes('monophthongs'), false);
  const checkbox = app.root.querySelector('[data-pitch-profile="rising"]');
  checkbox.checked = false;
  checkbox.listeners.change();
  assert.equal(app.saved(), 1);
  assert.equal(user.exerciseSettings['syllable-pitch'].profiles.includes('rising'), false);
  const reopened = load('/tests/syllable-pitch', JSON.parse(JSON.stringify(user)));
  reopened.root.querySelector('#session-count').value = '2';
  reopened.root.querySelector('#session-settings').listeners.submit({ preventDefault() {} });
  assert.equal(reopened.instance.session.options.profiles.includes('rising'), false);
  assert.equal(user.exerciseSettings['syllable-pitch'].profiles.length, 5);
  assert.equal(load('/tests/syllable-pitch', {}).instance.pitchProfiles.length, 6);
  assert.ok(app.root.innerHTML.indexOf('form="session-settings"') > app.root.innerHTML.indexOf('data-pitch-profile="descending"'));
});

test('start requires at least two pitch directions and one vowel category for all combinations', () => {
  const categories = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
  for (let mask = 0; mask < 64; mask++) {
    const profiles = categories.filter((_, i) => mask & (1 << i));
    const app = load('/tests/syllable-pitch', { exerciseSettings: { 'syllable-pitch': { profiles } } });
    const effective = profiles.filter(profile => profile !== 'monophthongs' || profiles.includes('flat'));
    const valid = effective.some(profile => categories.slice(0, 3).includes(profile)) && effective.filter(profile => categories.slice(3).includes(profile)).length >= 2;
    assert.equal(app.root.querySelector('[data-start-session]').disabled, !valid, String(mask));
    app.root.querySelector('#session-count').value = '2';
    app.root.querySelector('#session-count').value = '3';
  app.root.querySelector('#session-settings').listeners.submit({ preventDefault() {} });
    assert.equal(!!app.instance.session, valid, String(mask));
  }
  const app = load('/tests/syllable-pitch');
  for (const profile of ['flat', 'rising']) {
    const input = app.root.querySelector(`[data-pitch-profile="${profile}"]`);
    input.checked = false;
    input.listeners.change();
  }
  assert.equal(app.root.querySelector('[data-start-session]').disabled, true);
  const input = app.root.querySelector('[data-pitch-profile="flat"]');
  input.checked = true;
  input.listeners.change();
  assert.equal(app.root.querySelector('[data-start-session]').disabled, false);
});

test('disabling flat turns off monophthongs, saves the result, and locks its checkbox', () => {
  const user = {};
  const app = load('/tests/syllable-pitch', user);
  const flat = app.root.querySelector('[data-pitch-profile="flat"]');
  const mono = app.root.querySelector('[data-pitch-profile="monophthongs"]');
  flat.checked = false;
  flat.listeners.change();
  assert.equal(mono.checked, false);
  assert.equal(mono.disabled, true);
  assert.equal(user.exerciseSettings['syllable-pitch'].profiles.includes('monophthongs'), false);
  const reopened = load('/tests/syllable-pitch', JSON.parse(JSON.stringify(user)));
  assert.equal(reopened.root.querySelector('[data-pitch-profile="monophthongs"]').disabled, true);
  flat.checked = true;
  flat.listeners.change();
  assert.equal(mono.disabled, false);
  assert.equal(mono.checked, false);
});

test('catalog groups linked exercise tiles by category', () => {
  const { root } = load('/tests');
  assert.match(root.innerHTML, /<h2>Vowels<\/h2>/);
  assert.match(root.innerHTML, /href="#\/tests\/syllable-pitch"/);
});

test('tracked session progress survives reopening setup and untracked sessions add no history', () => {
  const user = { name: 'Test' };
  const { instance, root } = load('/tests/syllable-pitch', user);
  root.querySelector('#session-count').value = '3';
  root.querySelector('#session-settings').listeners.submit({ preventDefault() {} });
  assert.equal(instance.session.started, true);
  assert.equal(instance.session.options.limit, 3);
  instance.session.options.onProgress({ answered: 3, correct: 2 });
  instance.session.options.onFinish('Completed');
  assert.equal(user.testSessions.length, 1);
  const reopened = load('/tests/syllable-pitch/history', JSON.parse(JSON.stringify(user)));
  assert.match(reopened.root.querySelector('#test-history').innerHTML, /Completed/);
  assert.match(reopened.root.querySelector('#test-history').innerHTML, /2 \/ 3/);
  instance.startSession({ tracked: false, limit: null });
  instance.session.options.onFinish('Ended');
  assert.equal(user.testSessions.length, 1);
});

test('guests start untracked unlimited sessions; invalid counts cannot start a session', () => {
  const { instance, root } = load('/tests/syllable-pitch');
  root.querySelector('#session-count').value = '0';
  const submit = root.querySelector('#session-settings').listeners.submit;
  submit({ preventDefault() {} });
  assert.equal(instance.session, null);
  root.querySelector('#session-mode').value = 'unlimited';
  root.querySelector('#session-mode').listeners.change();
  assert.equal(root.querySelector('#session-count').disabled, true);
  submit({ preventDefault() {} });
  assert.equal(instance.session.options.tracked, false);
  assert.equal(instance.session.options.limit, null);
});

test('general preferences save immediately and are passed to sessions even when untracked', () => {
  const user = { name: 'Test' };
  const app = load('/tests/syllable-pitch', user);
  const checkbox = app.root.querySelector('[data-preference="pauseAfterCorrect"]');
  checkbox.checked = true;
  checkbox.listeners.change();
  assert.equal(user.testPreferences.pauseAfterCorrect, true);
  assert.equal(app.saved(), 1);
  const reopened = load('/tests/syllable-pitch', JSON.parse(JSON.stringify(user)));
  reopened.instance.startSession({ tracked: false, limit: 10 });
  assert.equal(reopened.instance.session.options.preferences.pauseAfterCorrect, true);
  assert.equal(user.testSessions, undefined);
  assert.ok(reopened.instance.session.options.profiles.includes('rising'));
});

test('history paginates, filters, and preserves answer details with older records', () => {
  const user = { testSessions: Array.from({ length: 12 }, (_, index) => ({
    exerciseId: 'syllable-pitch', startedAt: '2026-10-30T10:00:00Z', endedAt: '2026-10-30T10:01:00Z',
    limit: 10, answered: 10, correct: 8, status: index === 0 ? 'Interrupted' : 'Completed'
  })) };
  const { instance, root } = load('/tests/syllable-pitch/history', user);
  assert.match(root.querySelector('#test-history').innerHTML, /Page 1 of 2/);
  root.querySelector('[data-history-next]').listeners.click();
  assert.match(root.querySelector('#test-history').innerHTML, /Page 2 of 2/);
  root.querySelector('#history-filter').value = 'other';
  root.querySelector('#history-filter').listeners.change();
  assert.equal(instance.historyPage, 0);
  assert.match(root.querySelector('#test-history').innerHTML, /Interrupted/);
  assert.match(root.querySelector('#test-history').innerHTML, /Detailed answers were not recorded/);
  instance.startSession({ tracked: true, limit: 1 });
  const answer = { correct: true, pair: { label: 'Low' }, selected: { label: 'Low' }, type: 'Low' };
  instance.session.options.onProgress({ answered: 1, correct: 1, answer });
  instance.session.options.onFinish('Completed');
  assert.equal(user.testSessions.at(-1).answers[0], answer);
});

test('options link to a separate history page and include description and blank test settings', () => {
  const options = load('/tests/syllable-pitch');
  assert.match(options.root.innerHTML, /href="#\/tests\/syllable-pitch\/history"/);
  assert.match(options.root.innerHTML, /<h2>Description<\/h2>/);
  assert.match(options.root.innerHTML, /More about this test/);
  assert.doesNotMatch(options.root.innerHTML, /id="test-history"/);
  const history = load('/tests/syllable-pitch/history');
  assert.match(history.root.innerHTML, /history" aria-current="page"/);
  assert.match(history.root.querySelector('#test-history').innerHTML, /Sign in/);
  assert.doesNotMatch(history.root.innerHTML, /id="session-settings"/);
});

test('history plots use recorded scores and activity and respond to status filters', () => {
  const user = { testSessions: [
    { exerciseId: 'syllable-pitch', startedAt: '2026-10-29T10:00:00Z', limit: 4, answered: 4, correct: 1, status: 'Completed' },
    { exerciseId: 'syllable-pitch', startedAt: '2026-10-30T10:00:00Z', limit: 4, answered: 4, correct: 3, status: 'Interrupted' }
  ] };
  const { root } = load('/tests/syllable-pitch/history', user);
  let markup = root.querySelector('#test-history').innerHTML;
  assert.match(markup, /Accuracy by session/);
  assert.match(markup, /Practice activity/);
  assert.match(markup, /25% \(1\/4\)/);
  assert.match(markup, /75% \(3\/4\)/);
  assert.match(markup, /4 questions/);
  root.querySelector('#history-filter').value = 'Completed';
  root.querySelector('#history-filter').listeners.change();
  markup = root.querySelector('#test-history').innerHTML;
  assert.match(markup, /25% \(1\/4\)/);
  assert.doesNotMatch(markup, /75% \(3\/4\)/);
  const empty = load('/tests/syllable-pitch/history', { testSessions: [] });
  assert.match(empty.root.querySelector('#test-history').innerHTML, /No tracked sessions/);
  assert.doesNotMatch(empty.root.querySelector('#test-history').innerHTML, /<svg/);
});


test('nasality setup starts independently of pitch filters and keeps its own history', () => {
  const user = { exerciseSettings: { 'syllable-nasal': { profiles: [], mode: 'limited', count: 3 } } };
  const app = load('/tests/syllable-nasal', user);
  assert.match(app.root.innerHTML, /Syllable Nasality/);
  assert.doesNotMatch(app.root.innerHTML, /data-pitch-profile|Show Pitch Graph/);
  app.root.querySelector('#session-count').value = '3';
  app.root.querySelector('#session-settings').listeners.submit({ preventDefault() {} });
  assert.equal(app.instance.session.started, true);
  assert.equal(app.instance.session.options.limit, 3);
});


test('vowel contrast settings persist, require a selection, and reach the exercise', () => {
  const user = {};
  const app = load('/tests/vowel-length', user);
  assert.match(app.root.innerHTML, /Vowel contrasts/);
  assert.doesNotMatch(app.root.innerHTML, /data-pitch-profile|Show Pitch Graph/);
  for (const key of Object.keys(lengthContrasts)) {
    const node = app.root.querySelector(`[data-length-contrast="${key}"]`);
    node.checked = false;
    node.listeners.change();
  }
  assert.equal(app.root.querySelector('[data-start-session]').disabled, true);
  const node = app.root.querySelector('[data-length-contrast="diphthong_long_final"]');
  node.checked = true; node.listeners.change();
  assert.equal(app.root.querySelector('[data-start-session]').disabled, false);
  const reopened = load('/tests/vowel-length', JSON.parse(JSON.stringify(user)));
  assert.deepEqual(Array.from(reopened.instance.lengthContrasts), ['diphthong_long_final']);
  reopened.root.querySelector('#session-count').value = '3';
  reopened.root.querySelector('#session-settings').listeners.submit({ preventDefault() {} });
  assert.deepEqual(Array.from(reopened.instance.session.options.contrasts), ['diphthong_long_final']);
});
