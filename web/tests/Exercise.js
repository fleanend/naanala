// Shared lifecycle for recording exercises with one choice per syllable.
class Exercise {
  static text(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  static validateExercise(value, Type) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an exercise object.');
    const strings = list => Array.isArray(list) && list.every(item => typeof item === 'string');
    const fields = {
      example_id: item => typeof item === 'string' && item.length > 0,
      [Type.syllablesField]: strings, [Type.profileField]: strings,
      options_profile: list => Array.isArray(list) && list.every(strings),
      word: item => typeof item === 'string', audio_id: item => typeof item === 'string' && /^[a-zA-Z0-9_-]+$/.test(item)
    };
    const invalid = Object.keys(fields).filter(key => !fields[key](value[key]));
    if (invalid.length) throw new Error(`Invalid or missing ${invalid.join(', ')} in exercise.`);
    const count = value[Type.syllablesField].length;
    if (!count || value[Type.profileField].length !== count || value.options_profile.length !== count) throw new Error('Syllable, answer and option counts must match.');
    value.options_profile.forEach((options, i) => {
      if (value[Type.profileField][i] === 'P') {
        if (!options.every(tone => Type.validChoice(tone))) throw new Error(`Invalid answer options for syllable ${i + 1}.`);
        return;
      }
      if (!options.length || !options.includes(value[Type.profileField][i]) || !options.every(tone => Type.validChoice(tone)) || !Type.validChoice(value[Type.profileField][i])) {
        throw new Error(`Invalid answer options for syllable ${i + 1}.`);
      }
    });
    if (value[Type.profileField].every(tone => tone === 'P')) throw new Error('No enabled syllables in this exercise.');
    const original = value[Type.originalField];
    if (original !== undefined && (!strings(original) || original.length !== count || !original.every(tone => Type.validChoice(tone)))) {
      throw new Error('Invalid original profile.');
    }
    return { ...Object.fromEntries(Object.keys(fields).map(key => [key, value[key]])), ...(original ? { [Type.originalField]: original } : {}) };
  }

  static audioUrl(id) { return `/api/audio/${encodeURIComponent(id)}`; }

  static bindReviewMedia(root) {
    const cleanups = [];
    root.querySelectorAll('[data-frequency-review]').forEach(review => {
      const audio = review.querySelector('audio');
      if (!audio) return;
      const figure = review.querySelector('[data-frequency-duration]');
      const chart = review.querySelector('[data-frequency-chart]');
      const slider = review.querySelector('[data-frequency-seek]');
      const cursor = review.querySelector('[data-playhead]');
      const region = review.querySelector('[data-played-region]');
      const output = review.querySelector('[data-frequency-time]');
      const duration = Number(figure?.dataset.frequencyDuration) || 0;
      let frame = null;
      const listen = (element, event, handler) => {
        if (!element) return;
        element.addEventListener(event, handler);
        cleanups.push(() => element.removeEventListener(event, handler));
      };
      const update = () => {
        const time = Math.max(0, Math.min(duration, audio.currentTime || 0));
        const x = 50 + (duration ? time / duration : 0) * 570;
        cursor?.setAttribute('x1', x);
        cursor?.setAttribute('x2', x);
        region?.setAttribute('width', x - 50);
        if (slider) slider.value = String(time);
        if (output) output.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
      };
      const cancel = () => {
        if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
        frame = null;
      };
      const tick = () => {
        update();
        frame = !audio.paused && !audio.ended && globalThis.requestAnimationFrame ? requestAnimationFrame(tick) : null;
      };
      listen(audio, 'play', () => {
        root.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
        cancel(); tick();
      });
      for (const event of ['pause', 'ended']) listen(audio, event, () => { cancel(); update(); });
      for (const event of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'ratechange']) listen(audio, event, update);
      const seek = time => {
        if (!Number.isFinite(audio.duration) || !duration) return;
        audio.currentTime = Math.max(0, Math.min(audio.duration, time));
        update();
      };
      listen(slider, 'input', () => seek(Number(slider.value)));
      listen(chart, 'click', event => {
        const bounds = chart.getBoundingClientRect();
        if (bounds.width) seek(((event.clientX - bounds.left) / bounds.width * 640 - 50) / 570 * duration);
      });
      cleanups.push(() => { cancel(); audio.pause(); });
      update();
    });
    return () => cleanups.splice(0).forEach(cleanup => cleanup());
  }

  static review(item, preferences, Type) {
    const text = Type.text;
    // Keep summary records from the earlier dummy exercise readable.
    const pair = item.pair || {};
    const audio = item.audio_id ? Type.audioUrl(item.audio_id) : pair.audio;
    return `<div class="answer-review" data-frequency-review><strong>${item.correct ? 'Correct' : 'Incorrect'}</strong><p>${text(item.word || item.prompt || pair.label)}</p>
      ${item.syllables ? item.syllables.map(syllable => syllable.skipped ? `<div class="syllable-result"><strong>${text(syllable.label)}: Skipped</strong><p>Correct ${Type.answerLabel}: ${text(syllable.expected === 'P' ? 'Unavailable' : Type.choiceLabel(syllable.expected))}</p></div>` : `<div class="syllable-result ${syllable.correct ? 'result-correct' : 'result-incorrect'}"><strong>${text(syllable.label)}: ${syllable.correct ? 'Correct' : 'Incorrect'}</strong><p>Your ${Type.answerLabel}: ${text(Type.choiceLabel(syllable.selected))} · Correct ${Type.answerLabel}: ${text(Type.choiceLabel(syllable.expected))}</p>${preferences.showPitchGraph ? Type.answerGraph(syllable.expected) : ''}</div>`).join('') : `<p>Your answer: ${text(item.selected?.label)} · Correct answer: ${text(pair.label)}</p>`}
      ${audio ? `<audio controls preload="metadata" src="${text(audio)}" aria-label="Replay recording"></audio>` : ''}
      ${Number.isFinite(item.responseTimeMs) ? `<small>${(item.responseTimeMs / 1000).toFixed(1)} seconds</small>` : ''}</div>`;
  }

  // Subclasses declare API fields and labels, and override these hooks as needed.
  sessionSettings() { return {}; }
  answerDetails() { return {}; }

  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.preferences = { pauseAfterCorrect: false, pauseAfterIncorrect: true, showPitchGraph: true, ...options.preferences };
    this.state = { started: false, exercise: null, choices: [], submitted: false, history: [], loading: false, error: null };
    this.finished = false;
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
    this.stopAudio();
    const request = new AbortController();
    this.request = request;
    Object.assign(this.state, { exercise: null, choices: [], submitted: false, loading: true, error: null, recordingAnalysis: null });
    this.render();
    try {
      const position = this.state.history.length;
      if (!this.exercises || position - this.queueStart >= this.exercises.length) {
        const response = await fetch(this.constructor.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...this.sessionSettings(), question_count: this.options.limit ?? null }),
          signal: request.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const batch = await response.json();
        if (request.signal.aborted || this.finished) return;
        if (!Array.isArray(batch.exercises) || !batch.exercises.length) throw new Error('No exercises available.');
        const exercises = batch.exercises.map(item => this.constructor.validateExercise(item));
        if (new Set(exercises.map(item => item.example_id)).size !== exercises.length) throw new Error('Duplicate examples in session.');
        this.exercises = exercises;
        this.queueStart = position;
        if (this.options.limit) {
          this.effectiveLimit = Math.min(this.options.limit, exercises.length);
          this.options.onSessionReady?.({ limit: this.effectiveLimit });
        }
      }
      const exercise = this.exercises[position - this.queueStart];
      const recordingAnalysis = await this.decodeRecording(exercise.audio_id, request.signal);
      if (request.signal.aborted || this.finished) return;
      Object.assign(this.state, { exercise, recordingAnalysis, choices: exercise[this.constructor.profileField].map(tone => tone === 'P' ? 'P' : null) });
    } catch (error) {
      if (request.signal.aborted || this.finished) return;
      this.state.error = `Could not load the exercise. ${error.message} Retry after checking the backend.`;
    }
    if (request.signal.aborted || this.finished) return;
    this.state.loading = false;
    this.questionStartedAt = Date.now();
    this.render();
    const audio = this.root.querySelector('[data-question-audio]');
    audio?.play().catch(() => {});
  }

  async decodeRecording() { return null; }

  choose(index, value) {
    const exercise = this.state.exercise;
    if (this.finished || this.state.submitted || exercise?.[this.constructor.profileField][index] === 'P' || !exercise?.options_profile[index]?.includes(value)) return;
    this.state.choices[index] = value;
    const submit = this.root.querySelector('[data-submit]');
    if (submit) submit.disabled = this.state.choices.some(choice => choice === null);
  }

  submit() {
    const { exercise, choices, history } = this.state;
    if (this.finished || this.state.submitted || !exercise || choices.length !== exercise[this.constructor.profileField].length || choices.some((value, i) => exercise[this.constructor.profileField][i] !== 'P' && !exercise.options_profile[i].includes(value))) return;
    const syllables = exercise[this.constructor.syllablesField].map((label, i) => ({ label, selected: choices[i], expected: exercise[this.constructor.profileField][i] === 'P' ? (exercise[this.constructor.originalField]?.[i] || 'P') : exercise[this.constructor.profileField][i], skipped: exercise[this.constructor.profileField][i] === 'P', correct: choices[i] === exercise[this.constructor.profileField][i] }));
    const correct = syllables.filter(syllable => !syllable.skipped).every(syllable => syllable.correct);
    const answer = { correct, example_id: exercise.example_id, word: exercise.word, audio_id: exercise.audio_id, syllables, ...this.answerDetails(),
      type: `${syllables.length} syllable${syllables.length === 1 ? '' : 's'}`, pair: { label: exercise.word },
      answeredAt: new Date().toISOString(), responseTimeMs: Date.now() - this.questionStartedAt };
    history.unshift(answer);
    this.state.submitted = true;
    this.options.onProgress?.({ answered: history.length, correct: history.filter(item => item.correct).length, answer });
    if (this.effectiveLimit && history.length >= this.effectiveLimit) return this.finish('Completed');
    this.stopAudio();
    this.render();
    if (!(correct ? this.preferences.pauseAfterCorrect : this.preferences.pauseAfterIncorrect)) this.timer = setTimeout(() => this.load(), 1400);
  }

  render() {
    this.cleanupReviewMedia?.();
    const text = this.constructor.text;
    const { started, exercise, choices, submitted, history, loading, error } = this.state;
    this.root.innerHTML = `<section aria-label="${text(this.constructor.title)} test"><h1>${text(this.constructor.title)}</h1>
      ${!started ? '<button data-start>Start</button>' : `<p>${this.options.tracked ? 'Tracked' : 'Untracked'} · ${history.length}${this.options.limit ? ` / ${this.effectiveLimit ?? this.options.limit}` : ''} questions answered · ${history.filter(item => item.correct).length} correct</p>`}
      ${this.effectiveLimit < this.options.limit ? `<p>Only ${this.effectiveLimit} examples match these settings. This test uses each once.</p>` : ''}
      ${this.finished ? `<h2>Session ${this.finishStatus === 'Completed' ? 'complete' : 'ended'}</h2><button data-back>Back to exercise settings</button><h2>Answer review</h2>${history.slice().reverse().map(item => this.constructor.review(item, this.preferences)).join('')}` : started ? `
        ${loading ? '<p role="status">Loading exercise…</p>' : ''}
        ${error ? `<p role="alert">${text(error)}</p><button data-retry>Retry</button>` : ''}
        ${exercise ? `<h2>${text(exercise[this.constructor.syllablesField].join(' · '))}</h2><p>${text(this.constructor.instructions)}</p>
          <audio data-question-audio controls preload="auto" src="${this.constructor.audioUrl(exercise.audio_id)}" aria-label="Question recording"></audio><p data-audio-error role="status"></p>
          <form data-answer-form><div class="syllable-choices">${exercise[this.constructor.syllablesField].map((syllable, i) => exercise[this.constructor.profileField][i] === 'P' ? `<div class="syllable-result"><strong>Syllable ${i + 1}: ${text(syllable)}</strong><p>Correct ${this.constructor.answerLabel}: ${text(exercise[this.constructor.originalField]?.[i] || 'Unavailable')}</p></div>` : `<fieldset ${submitted ? 'disabled' : ''}><legend>Syllable ${i + 1}: ${text(syllable)}</legend>${exercise.options_profile[i].map(contour => `<label class="contour-choice"><input type="radio" name="syllable-${i}" data-syllable="${i}" value="${text(contour)}" ${choices[i] === contour ? 'checked' : ''} required>${text(this.constructor.choiceLabel(contour))}</label>`).join('')}</fieldset>`).join('')}</div>
          ${!submitted ? '<button data-submit type="submit" disabled>Check answer</button>' : ''}</form>
          ${submitted ? `<div role="status">${this.constructor.review(history[0], this.preferences)}</div><button data-continue>Continue</button>` : ''}` : ''}
        <div class="actions"><button data-end class="secondary">End session</button></div>
        ${history.length ? `<details><summary>Answers this session (${history.length})</summary>${history.map(item => this.constructor.review(item, this.preferences)).join('')}</details>` : ''}` : ''}
      <audio data-review-player hidden></audio></section>`;
    const on = (selector, event, fn) => this.root.querySelector(selector)?.addEventListener(event, fn);
    on('[data-start]', 'click', () => this.start());
    on('[data-retry]', 'click', () => this.load());
    on('[data-continue]', 'click', () => this.load());
    on('[data-end]', 'click', () => this.finish('Ended'));
    on('[data-back]', 'click', () => this.options.onBack?.());
    on('[data-answer-form]', 'submit', event => { event.preventDefault(); this.submit(); });
    on('[data-question-audio]', 'error', () => { this.root.querySelector('[data-audio-error]').textContent = 'Recording could not be played. Your browser may not support this OGG recording.'; });
    this.root.querySelectorAll('[data-syllable]').forEach(input => input.addEventListener('change', () => this.choose(Number(input.dataset.syllable), input.value)));
    this.root.querySelectorAll('[data-replay]').forEach(button => button.addEventListener('click', () => {
      const audio = this.root.querySelector('[data-review-player]');
      this.stopAudio();
      if (audio) { audio.src = button.dataset.replay; audio.play().catch(() => {}); }
    }));
    this.cleanupReviewMedia = this.constructor.bindReviewMedia(this.root);
  }

  stopAudio() { this.root.querySelectorAll('audio').forEach(audio => audio.pause()); }

  finish(status) {
    if (this.finished) return;
    this.finished = true;
    this.finishStatus = status;
    this.request?.abort();
    clearTimeout(this.timer);
    this.stopAudio();
    this.options.onFinish?.(status);
    this.render();
  }

  destroy() {
    this.cleanupReviewMedia?.();
    this.request?.abort();
    clearTimeout(this.timer);
    this.stopAudio();
    if (this.state.started && !this.finished) {
      this.finished = true;
      this.options.onFinish?.('Interrupted');
    }
  }
}
