import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/tests/Tests.js', import.meta.url), 'utf8');
function load(path, user) {
  const nodes = new Map();
  const root = { innerHTML: '', querySelectorAll(selector) {
    if (selector === '[data-preference]') return ['pauseAfterCorrect', 'pauseAfterIncorrect', 'showPitchGraph', 'playAudioInline'].map(key => {
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
    static review() { return '<p>Answer review fixture</p>'; }
    constructor(_, options) { this.options = options; }
    start() { this.started = true; }
    destroy() {}
  }
  const instance = runInNewContext(`${source}\nnew Tests(root, context)`, {
    root, context: { path, user, persist: () => { saved++; }, signIn() {} }, SyllablePitch
  });
  return { instance, root, saved: () => saved };
}

test('catalog groups linked exercise tiles by category', () => {
  const { root } = load('/tests');
  assert.match(root.innerHTML, /<h2>Pitch<\/h2>/);
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
  assert.match(reopened.root.innerHTML, /<h2>Test settings<\/h2><\/section>/);
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
