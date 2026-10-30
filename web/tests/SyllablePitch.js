// Adapted from reference/legacy/Sources/UI/Components/Tests/PitchAccent/MinimalPairs.js.
// Plain browser JavaScript: the current app does not load React or Bootstrap.
class SyllablePitch {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.finished = false;
    this.state = { syllablePitch: null, pairIndex: null, selectedIndex: null, started: false, history: [] };
    this.preferences = { pauseAfterCorrect: false, pauseAfterIncorrect: true, showPitchGraph: true, playAudioInline: true, ...options.preferences };
    this.timer = null;
    this.render();
  }

  start() {
    if (this.state.started) return;
    this.state.started = true;
    return this.load();
  }

  async load() {
    if (this.finished) return;
    clearTimeout(this.timer);
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.state.syllablePitch = null;
    this.state.selectedIndex = null;
    this.state.loading = true;
    this.state.error = null;
    this.render();

    try {
      const response = await fetch('/api/tests/syllable-pitch/random', { signal: request.signal });
      if (!response.ok) throw new Error('Could not load exercise');
      const exercise = await response.json();
      if (!Array.isArray(exercise.pairs) || exercise.pairs.length < 2 ||
          !exercise.pairs.every(pair => typeof pair.label === 'string' && typeof pair.category === 'string' && typeof pair.audio === 'string')) {
        throw new Error('Invalid exercise response');
      }
      if (this.finished || request.signal.aborted) return;
      this.state.syllablePitch = exercise;
      this.state.pairIndex = Math.floor(Math.random() * exercise.pairs.length);
    } catch (error) {
      if (request.signal.aborted || this.finished) return;
      this.state.error = 'Could not load the exercise. Check that the Python backend is running, then retry.';
    }
    if (request.signal.aborted || this.finished) return;
    this.state.loading = false;
    this.questionStartedAt = Date.now();
    // Target shape:
    // { prompt: '...', pairs: [{ label: '...', category: '...', audio: '...' }, ...] }
    // Legacy display data used kana, soundFile, and entries[0].accents[0].accent[0].
    // Helpers.outputAccentPlainText(pronunciation, pitchAccent) formatted Japanese answers.
    // The old audio URL was `/api/media/nhk/audio/${pair.soundFile}`.
    this.render();
  }

  selectIndex(index) {
    const { syllablePitch, pairIndex, selectedIndex, history } = this.state;
    if (!syllablePitch || this.finished || !Number.isInteger(index) || !syllablePitch.pairs[index]) return;
    if (selectedIndex !== null) return this.playAudio(syllablePitch.pairs[index].audio);
    const pair = syllablePitch.pairs[pairIndex];
    const correct = index === pairIndex;
    // DATA: Japanese categories were derived from pitchAccent and entry.moraCount:
    // 0 or moraCount => Heiban / Odaka; 1 => Atamadaka; otherwise Nakadaka.
    const answer = { correct, pair, selected: syllablePitch.pairs[index], type: pair.category,
      prompt: syllablePitch.prompt, answeredAt: new Date().toISOString(),
      responseTimeMs: this.questionStartedAt ? Date.now() - this.questionStartedAt : 0 };
    history.unshift(answer);
    this.state.selectedIndex = index;
    this.options.onProgress?.({ answered: history.length, correct: history.filter(item => item.correct).length, answer });
    if (this.options.limit && history.length >= this.options.limit) {
      this.finish('Completed');
      return;
    }
    this.render();
    if (!this.shouldShowContinue(index)) this.timer = setTimeout(() => this.load(), 1000);
  }

  shouldShowContinue(index) {
    const correct = index === this.state.pairIndex;
    return correct ? this.preferences.pauseAfterCorrect : this.preferences.pauseAfterIncorrect;
    // DATA: previously read from user.settings.tests.pitchAccent.minimalPairs.
  }

  playAudio(url) {
    if (!url) return;
    const audio = this.root.querySelector('[data-question-audio]');
    if (!audio) return;
    audio.src = url;
    audio.play().catch(() => { /* Native audio controls remain available. */ });
  }

  static review(item, preferences) {
    const text = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const pair = item.pair || {};
    const pitch = Array.isArray(pair.pitch) ? pair.pitch.filter(value => Number.isFinite(value) && value >= 0 && value <= 1) : [];
    const graph = preferences.showPitchGraph && pitch.length > 1 ? `<svg class="pitch-graph" viewBox="0 0 160 60" role="img" aria-label="${text(pair.label)} pitch graph"><path d="M 8 4 V 52 H 152" fill="none" stroke="currentColor" opacity=".3"/><polyline points="${pitch.map((value, i) => `${8 + i * 144 / (pitch.length - 1)},${48 - value * 40}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="3"/></svg>` : '';
    const audio = pair.audio ? (preferences.playAudioInline
      ? `<audio controls preload="none" src="${text(pair.audio)}" aria-label="Replay ${text(pair.label)}"></audio>`
      : `<button class="secondary" data-replay="${text(pair.audio)}">Replay audio</button>`) : '';
    return `<div class="answer-review"><strong>${item.correct ? 'Correct' : 'Incorrect'}</strong>
      <p>${text(item.prompt)}<br>Your answer: ${text(item.selected?.label ?? 'Not recorded')} · Correct answer: ${text(pair.label)}</p>
      ${graph}${audio}${Number.isFinite(item.responseTimeMs) ? `<small>${(item.responseTimeMs / 1000).toFixed(1)} seconds</small>` : ''}</div>`;
  }

  render() {
    const text = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const { started, syllablePitch, pairIndex, selectedIndex, history } = this.state;
    this.root.innerHTML = `<section aria-label="Syllable pitch test">
      <h1>Syllable Pitch Perception Test</h1>
      ${started ? `<p>${this.options.tracked ? 'Tracked' : 'Untracked'} · ${this.options.limit ? `${history.length} / ${this.options.limit} questions` : `${history.length} answered · Unlimited`}</p>` : ''}
      ${this.finished ? `<h2>Session ${this.finishStatus === 'Completed' ? 'complete' : 'ended'}</h2><p>${history.filter(item => item.correct).length} correct out of ${history.length} answered.</p><button data-back>Back to exercise settings</button><h2>Answer review</h2>${history.slice().reverse().map(item => SyllablePitch.review(item, this.preferences)).join('')}<audio data-review-player hidden></audio>` : !started ? '<button data-start>Start</button>' : `
        <div class="test-columns">
          <aside><h2>History</h2>${history.map(item => `<details><summary>${item.correct ? 'Correct' : 'Incorrect'}: ${text(item.pair.label)}</summary>${SyllablePitch.review(item, this.preferences)}</details>`).join('')}</aside>
          <section aria-label="Question">
            <h2>${text(syllablePitch?.prompt || 'Listening exercise')}</h2>
            <audio data-question-audio controls aria-label="Exercise audio"></audio>
            ${this.state.loading ? '<p role="status">Loading exercise…</p>' : ''}
            ${this.state.error ? `<p role="alert">${text(this.state.error)}</p><button data-retry>Retry</button>` : ''}
            ${syllablePitch?.dummy ? '<p>Dummy audio: synthetic tones for testing, not Navajo recordings.</p>' : ''}
            <div class="actions">${(syllablePitch?.pairs || []).map((pair, i) => `<button data-answer="${i}" ${selectedIndex !== null ? `class="${i === pairIndex ? 'answer-correct' : 'answer-incorrect'}"` : ''}>${text(pair.label)}${selectedIndex !== null ? (i === pairIndex ? ' (Correct answer)' : ' (Incorrect)') : ''}</button>`).join('')}</div>
            ${selectedIndex !== null ? SyllablePitch.review(history[0], this.preferences) : ''}
            ${selectedIndex !== null && this.shouldShowContinue(selectedIndex) ? '<button data-continue>Continue</button>' : ''}
          </section>
          <aside><h2>Statistics</h2>${history.length ? [...new Set(history.map(item => item.type))].map(type => {
            const all = history.filter(item => item.type === type);
            const correct = all.filter(item => item.correct).length;
            return `<p>${text(type)}: ${correct} of ${all.length} (${Math.round(correct / all.length * 100)}%)</p>`;
          }).join('') : '<p>No answers yet.</p>'}</aside>
        </div><audio data-review-player hidden></audio><div class="actions"><button data-end class="secondary">End session</button></div>`}
    </section>`;
    this.root.querySelector('[data-start]')?.addEventListener('click', () => this.start());
    this.root.querySelector('[data-continue]')?.addEventListener('click', () => this.load());
    this.root.querySelector('[data-retry]')?.addEventListener('click', () => this.load());
    this.root.querySelector('[data-end]')?.addEventListener('click', () => this.finish('Ended'));
    this.root.querySelector('[data-back]')?.addEventListener('click', () => this.options.onBack?.());
    this.root.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => this.selectIndex(Number(button.dataset.answer))));
    this.root.querySelectorAll('[data-replay]').forEach(button => button.addEventListener('click', () => {
      const audio = this.root.querySelector('[data-review-player]') || this.root.querySelector('audio');
      if (audio) { audio.src = button.dataset.replay; audio.play().catch(() => {}); }
    }));
    if (!this.finished && syllablePitch && selectedIndex === null) this.playAudio(syllablePitch.pairs[pairIndex].audio);
  }

  finish(status) {
    if (this.finished) return;
    this.finished = true;
    this.request?.abort();
    this.finishStatus = status;
    clearTimeout(this.timer);
    this.root.querySelectorAll('audio').forEach(audio => audio.pause());
    this.options.onFinish?.(status);
    this.render();
  }

  destroy() {
    this.request?.abort();
    clearTimeout(this.timer);
    this.root.querySelectorAll('audio').forEach(audio => audio.pause());
    if (this.state.started && !this.finished) {
      this.finished = true;
      this.options.onFinish?.('Interrupted');
    }
  }
}
