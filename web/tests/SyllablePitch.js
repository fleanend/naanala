// Syllable Pitch: one contour choice per syllable, one score per word.
class SyllablePitch {
  static text(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  static validateExercise(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an exercise object.');
    const strings = list => Array.isArray(list) && list.every(item => typeof item === 'string');
    const fields = {
      syllables_no_pitch: strings, tone_profile: strings,
      options_profile: list => Array.isArray(list) && list.every(strings),
      word: item => typeof item === 'string', audio_id: item => typeof item === 'string' && /^[a-zA-Z0-9_-]+$/.test(item)
    };
    const invalid = Object.keys(fields).filter(key => !fields[key](value[key]));
    if (invalid.length) throw new Error(`Invalid or missing ${invalid.join(', ')} in PitchSyllableExercise.`);
    const count = value.syllables_no_pitch.length;
    if (!count || value.tone_profile.length !== count || value.options_profile.length !== count) throw new Error('Syllable, tone and option counts must match.');
    value.options_profile.forEach((options, i) => {
      if (value.tone_profile[i] === 'P') {
        if (!options.every(tone => /^[HL]+$/.test(tone))) throw new Error(`Invalid contour options for syllable ${i + 1}.`);
        return;
      }
      if (!options.length || !options.includes(value.tone_profile[i]) || !options.every(tone => /^[HL]+$/.test(tone)) || !/^[HL]+$/.test(value.tone_profile[i])) {
        throw new Error(`Invalid contour options for syllable ${i + 1}.`);
      }
    });
    if (value.tone_profile.every(tone => tone === 'P')) throw new Error('No enabled syllables in this exercise.');
    const original = value.original_tone_profile;
    if (original !== undefined && (!strings(original) || original.length !== count || !original.every(tone => /^[HL]+$/.test(tone)))) {
      throw new Error('Invalid original tone profile.');
    }
    return { ...Object.fromEntries(Object.keys(fields).map(key => [key, value[key]])), ...(original ? { original_tone_profile: original } : {}) };
  }

  static audioUrl(id) { return `/api/audio/${encodeURIComponent(id)}`; }

  // YIN-style fundamental-frequency estimation. Unvoiced frames remain gaps.
  static estimatePitch(buffer) {
    const stride = Math.max(1, Math.floor(buffer.sampleRate / 8000));
    const rate = buffer.sampleRate / stride;
    const samples = new Float32Array(Math.floor(buffer.length / stride));
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        let total = 0;
        for (let j = 0; j < stride; j++) total += source[i * stride + j];
        samples[i] += total / stride / buffer.numberOfChannels;
      }
    }
    const minLag = Math.floor(rate / 600);
    const maxLag = Math.ceil(rate / 60);
    const windowSize = Math.max(Math.round(rate * .05), maxLag * 3);
    const hop = Math.max(Math.round(rate * .01), Math.ceil(samples.length / 240));
    const points = [];
    // A fixed amplitude cutoff discarded quiet, otherwise periodic speech.
    // Calibrate to the recording, with a small floor to reject digital silence.
    let loudestRms = 0;
    for (let offset = 0; offset + windowSize <= samples.length; offset += hop) {
      let energy = 0;
      for (let i = 0; i < windowSize; i++) energy += samples[offset + i] ** 2;
      loudestRms = Math.max(loudestRms, Math.sqrt(energy / windowSize));
    }
    const silenceThreshold = Math.max(.0003, loudestRms * .025);
    for (let offset = 0; offset + windowSize <= samples.length; offset += hop) {
      let energy = 0;
      for (let i = 0; i < windowSize; i++) energy += samples[offset + i] ** 2;
      let hz = null;
      if (Math.sqrt(energy / windowSize) >= silenceThreshold) {
        const difference = new Float64Array(maxLag + 1);
        const normalized = new Float64Array(maxLag + 1);
        normalized[0] = 1;
        let sum = 0;
        for (let lag = 1; lag <= maxLag; lag++) {
          for (let i = 0; i < windowSize - maxLag; i++) difference[lag] += (samples[offset + i] - samples[offset + i + lag]) ** 2;
          sum += difference[lag];
          normalized[lag] = sum ? difference[lag] * lag / sum : 1;
        }
        let lag = minLag;
        for (; lag < maxLag; lag++) {
          if (normalized[lag] < .22) {
            while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
            break;
          }
        }
        if (lag === maxLag) {
          // Natural speech is less perfectly periodic than a synthetic sine.
          // Accept a clear local trough rather than requiring the strict cutoff.
          let best = minLag;
          for (let candidate = minLag + 1; candidate < maxLag; candidate++) {
            if (normalized[candidate] < normalized[best]) best = candidate;
          }
          if (normalized[best] < .42) {
            lag = best;
            for (let candidate = minLag + 1; candidate < best; candidate++) {
              if (normalized[candidate] <= normalized[best] + .035 && normalized[candidate] < normalized[candidate - 1] && normalized[candidate] <= normalized[candidate + 1]) { lag = candidate; break; }
            }
          }
        }
        if (lag < maxLag && normalized[lag] < .42) {
          const left = normalized[lag - 1], center = normalized[lag], right = normalized[lag + 1];
          const denominator = left - 2 * center + right;
          const refined = lag + (denominator ? Math.max(-1, Math.min(1, .5 * (left - right) / denominator)) : 0);
          const estimate = rate / refined;
          if (estimate >= 60 && estimate <= 600) hz = Math.round(estimate * 10) / 10;
        }
      }
      points.push({ time: (offset + windowSize / 2) / rate, hz });
    }
    // Bridge only very short, pitch-consistent dropouts, never long pauses.
    for (let i = 1; i < points.length - 1; i++) {
      if (points[i].hz !== null || points[i - 1].hz === null) continue;
      let next = i + 1;
      while (next < points.length && points[next].hz === null) next++;
      if (next < points.length && points[next].time - points[i - 1].time <= .035 && Math.abs(Math.log2(points[next].hz / points[i - 1].hz)) < .25) {
        for (let index = i; index < next; index++) points[index].hz = points[i - 1].hz + (points[next].hz - points[i - 1].hz) * (index - i + 1) / (next - i + 1);
      }
    }
    return { version: 2, duration: buffer.length / buffer.sampleRate, points };
  }

  // Smooth only the display; retain the measured track for saved answers.
  static smoothPitch(points) {
    const result = points.map(point => ({ ...point }));
    let start = 0;
    const valid = point => Number.isFinite(point.time) && Number.isFinite(point.hz) && point.hz >= 60 && point.hz <= 600;
    while (start < points.length) {
      if (!valid(points[start])) { start++; continue; }
      let end = start + 1;
      while (end < points.length && valid(points[end]) && points[end].time > points[end - 1].time && points[end].time - points[end - 1].time <= .035) end++;
      for (let i = start + 1; i < end - 1; i++) {
        let sum = 0, weight = 0;
        for (let j = Math.max(start, i - 3); j <= Math.min(end - 1, i + 3); j++) {
          const w = Math.max(0, 1 - Math.abs(points[j].time - points[i].time) / .035);
          sum += points[j].hz * w;
          weight += w;
        }
        result[i].hz = sum / weight;
      }
      start = end;
    }
    return result;
  }

  static frequencyMarkup(track) {
    const points = SyllablePitch.smoothPitch(Array.isArray(track?.points) ? track.points : []);
    const voiced = points.filter(point => Number.isFinite(point.time) && Number.isFinite(point.hz) && point.hz >= 60 && point.hz <= 600);
    if (!voiced.length || !Number.isFinite(track?.duration) || track.duration <= 0) return '<p class="waveform-note">No reliable pitch-frequency curve available for this recording.</p>';
    const minimum = Math.min(...voiced.map(point => point.hz));
    const maximum = Math.max(...voiced.map(point => point.hz));
    const padding = Math.max(5, (maximum - minimum) * .1);
    const low = Math.max(0, Math.floor(minimum - padding));
    const high = Math.ceil(maximum + padding);
    const y = hz => 140 - (hz - low) / (high - low) * 115;
    let path = '', segment = [];
    const flush = () => {
      if (!segment.length) return;
      path += `M${segment[0].x} ${segment[0].y} `;
      const slopes = segment.slice(1).map((point, i) => (point.y - segment[i].y) / (point.x - segment[i].x));
      // Monotone cubic interpolation rounds corners without adding new peaks.
      const tangents = segment.map((_, i) => {
        if (i === 0 || i === segment.length - 1) return 0;
        const left = slopes[i - 1], right = slopes[i];
        return left * right <= 0 ? 0 : 2 * left * right / (left + right);
      });
      for (let i = 1; i < segment.length; i++) {
        const a = segment[i - 1], b = segment[i], dx = (b.x - a.x) / 3;
        path += `C${a.x + dx} ${a.y + dx * tangents[i - 1]} ${b.x - dx} ${b.y - dx * tangents[i]} ${b.x} ${b.y} `;
      }
      if (segment.length === 1) path += `L${segment[0].x} ${segment[0].y} `;
      segment = [];
    };
    for (const point of points) {
      // Connect detected sections across dropouts for a continuous display.
      if (!Number.isFinite(point.time) || !Number.isFinite(point.hz) || point.hz < 60 || point.hz > 600) continue;
      const x = 50 + Math.max(0, Math.min(1, point.time / track.duration)) * 570;
      const previous = segment[segment.length - 1];
      if (previous && x <= previous.x) flush();
      segment.push({ x, y: y(point.hz), time: point.time });
    }
    // Start at the lower axis padding; hold the last pitch through trailing dropouts.
    // These display extensions do not alter the measured track.
    if (segment.length) {
      const first = segment[0], last = segment[segment.length - 1];
      if (first.x > 50) segment.unshift({ x: 50, y: y(low), time: 0 });
      if (last.x < 620) segment.push({ ...last, x: 620, time: track.duration });
    }
    flush();
    return `<figure class="recording-waveform frequency-player" data-frequency-duration="${track.duration}"><figcaption><strong>Pitch frequency</strong><span>Hz · smoothed estimated F0</span></figcaption><svg data-frequency-chart viewBox="0 0 640 180" role="img" aria-label="Estimated fundamental frequency in hertz over time">${[low, (low + high) / 2, high].map(hz => `<path d="M50 ${y(hz)} H620" stroke="currentColor" opacity=".15"/><text x="2" y="${y(hz) + 4}" fill="currentColor" font-size="12">${Math.round(hz)}</text>`).join('')}<rect data-played-region x="50" y="20" width="0" height="125" fill="currentColor" opacity=".07"/><path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line data-playhead x1="50" x2="50" y1="20" y2="145" stroke="currentColor" stroke-width="2"/><text x="50" y="170" fill="currentColor" font-size="12">0 s</text><text x="620" y="170" text-anchor="end" fill="currentColor" font-size="12">${track.duration.toFixed(2)} s</text></svg><label class="frequency-seek-label">Seek recording<input data-frequency-seek type="range" min="0" max="${track.duration}" step="0.01" value="0"></label><output data-frequency-time>0.00 / ${track.duration.toFixed(2)} s</output><small>Click the graph to seek. The curve connects missing pitch sections, starts at the lower axis padding, and holds the final detected pitch.</small></figure>`;
  }

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
      const button = review.querySelector('[data-review-play]');
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
        if (button) button.textContent = audio.paused ? 'Play recording' : 'Pause recording';
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
      listen(button, 'click', () => {
        if (audio.paused) {
          if (audio.ended) audio.currentTime = 0;
          audio.play().catch(() => { if (button) button.textContent = 'Playback unavailable — try again'; });
        } else audio.pause();
      });
      cleanups.push(() => { cancel(); audio.pause(); });
      update();
    });
    return () => cleanups.splice(0).forEach(cleanup => cleanup());
  }

  static contourGraph(contour) {
    const samples = [...contour].map(tone => tone === 'H' ? 12 : 46);
    if (!samples.length) return '';
    const points = samples.length === 1 ? `8,${samples[0]} 152,${samples[0]}` : samples.map((height, i) => `${8 + i * 144 / (samples.length - 1)},${height}`).join(' ');
    return `<svg class="pitch-graph" viewBox="0 0 160 60" role="img" aria-label="${SyllablePitch.text(contour)} pitch contour"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/></svg>`;
  }

  static review(item, preferences) {
    const text = SyllablePitch.text;
    // Keep summary records from the earlier dummy exercise readable.
    const pair = item.pair || {};
    const audio = item.audio_id ? SyllablePitch.audioUrl(item.audio_id) : pair.audio;
    return `<div class="answer-review" data-frequency-review><strong>${item.correct ? 'Correct' : 'Incorrect'}</strong><p>${text(item.word || item.prompt || pair.label)}</p>
      ${item.syllables ? item.syllables.map(syllable => syllable.skipped ? `<div class="syllable-result"><strong>${text(syllable.label)}: Skipped</strong><p>Correct contour: ${text(syllable.expected === 'P' ? 'Unavailable' : syllable.expected)}</p></div>` : `<div class="syllable-result ${syllable.correct ? 'result-correct' : 'result-incorrect'}"><strong>${text(syllable.label)}: ${syllable.correct ? 'Correct' : 'Incorrect'}</strong><p>Your contour: ${text(syllable.selected)} · Correct contour: ${text(syllable.expected)}</p>${preferences.showPitchGraph ? SyllablePitch.contourGraph(syllable.expected) : ''}</div>`).join('') : `<p>Your answer: ${text(item.selected?.label)} · Correct answer: ${text(pair.label)}</p>`}
      ${audio ? `<audio ${preferences.playAudioInline ? 'controls' : 'hidden'} preload="metadata" src="${text(audio)}" aria-label="Replay recording"></audio>${preferences.playAudioInline ? '' : '<button class="secondary" data-review-play>Play recording</button>'}` : ''}
      ${Number.isFinite(item.responseTimeMs) ? `<small>${(item.responseTimeMs / 1000).toFixed(1)} seconds</small>` : ''}</div>`;
  }

  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.preferences = { pauseAfterCorrect: false, pauseAfterIncorrect: true, showPitchGraph: true, playAudioInline: true, ...options.preferences };
    this.state = { started: false, syllablePitch: null, choices: [], submitted: false, history: [], loading: false, error: null };
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
    Object.assign(this.state, { syllablePitch: null, choices: [], submitted: false, loading: true, error: null, pitchTrack: null });
    this.render();
    try {
      const categories = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
      const selected = this.options.profiles ?? categories;
      const response = await fetch('/api/tests/syllable-pitch/random', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(categories.map(category => [category, selected.includes(category)]))),
        signal: request.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const exercise = SyllablePitch.validateExercise(await response.json());
      const pitchTrack = await this.decodeRecording(exercise.audio_id, request.signal);
      if (request.signal.aborted || this.finished) return;
      Object.assign(this.state, { syllablePitch: exercise, pitchTrack, choices: exercise.tone_profile.map(tone => tone === 'P' ? 'P' : null) });
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

  async decodeRecording(id, signal) {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return null;
    let context;
    try {
      const response = await fetch(SyllablePitch.audioUrl(id), { signal });
      if (!response.ok) throw new Error('Recording unavailable');
      context = new Audio();
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return SyllablePitch.estimatePitch(buffer);
    } catch {
      // Native playback may still work if Web Audio decoding is unsupported.
      return null;
    } finally { await context?.close(); }
  }

  choose(index, value) {
    const exercise = this.state.syllablePitch;
    if (this.finished || this.state.submitted || exercise?.tone_profile[index] === 'P' || !exercise?.options_profile[index]?.includes(value)) return;
    this.state.choices[index] = value;
    const submit = this.root.querySelector('[data-submit]');
    if (submit) submit.disabled = this.state.choices.some(choice => choice === null);
  }

  submit() {
    const { syllablePitch: exercise, choices, history } = this.state;
    if (this.finished || this.state.submitted || !exercise || choices.length !== exercise.tone_profile.length || choices.some((value, i) => exercise.tone_profile[i] !== 'P' && !exercise.options_profile[i].includes(value))) return;
    const syllables = exercise.syllables_no_pitch.map((label, i) => ({ label, selected: choices[i], expected: exercise.tone_profile[i] === 'P' ? (exercise.original_tone_profile?.[i] || 'P') : exercise.tone_profile[i], skipped: exercise.tone_profile[i] === 'P', correct: choices[i] === exercise.tone_profile[i] }));
    const correct = syllables.filter(syllable => !syllable.skipped).every(syllable => syllable.correct);
    const answer = { correct, word: exercise.word, audio_id: exercise.audio_id, syllables, pitchTrack: this.state.pitchTrack,
      type: `${syllables.length} syllable${syllables.length === 1 ? '' : 's'}`, pair: { label: exercise.word },
      answeredAt: new Date().toISOString(), responseTimeMs: Date.now() - this.questionStartedAt };
    history.unshift(answer);
    this.state.submitted = true;
    this.options.onProgress?.({ answered: history.length, correct: history.filter(item => item.correct).length, answer });
    if (this.options.limit && history.length >= this.options.limit) return this.finish('Completed');
    this.stopAudio();
    this.render();
    if (!(correct ? this.preferences.pauseAfterCorrect : this.preferences.pauseAfterIncorrect)) this.timer = setTimeout(() => this.load(), 1400);
  }

  render() {
    this.cleanupReviewMedia?.();
    const text = SyllablePitch.text;
    const { started, syllablePitch: exercise, choices, submitted, history, loading, error } = this.state;
    this.root.innerHTML = `<section aria-label="Syllable pitch test"><h1>Syllable Pitch</h1>
      ${!started ? '<button data-start>Start</button>' : `<p>${this.options.tracked ? 'Tracked' : 'Untracked'} · ${history.length}${this.options.limit ? ` / ${this.options.limit}` : ''} questions answered · ${history.filter(item => item.correct).length} correct</p>`}
      ${this.finished ? `<h2>Session ${this.finishStatus === 'Completed' ? 'complete' : 'ended'}</h2><button data-back>Back to exercise settings</button><h2>Answer review</h2>${history.slice().reverse().map(item => SyllablePitch.review(item, this.preferences)).join('')}` : started ? `
        ${loading ? '<p role="status">Loading exercise…</p>' : ''}
        ${error ? `<p role="alert">${text(error)}</p><button data-retry>Retry</button>` : ''}
        ${exercise ? `<h2>${text(exercise.syllables_no_pitch.join(' · '))}</h2><p>Listen, then choose one contour for each syllable. H = high, L = low.</p>
          <audio data-question-audio controls preload="auto" src="${SyllablePitch.audioUrl(exercise.audio_id)}" aria-label="Question recording"></audio><p data-audio-error role="status"></p>
          <form data-answer-form><div class="syllable-choices">${exercise.syllables_no_pitch.map((syllable, i) => exercise.tone_profile[i] === 'P' ? `<div class="syllable-result"><strong>Syllable ${i + 1}: ${text(syllable)}</strong><p>Correct contour: ${text(exercise.original_tone_profile?.[i] || 'Unavailable')}</p></div>` : `<fieldset ${submitted ? 'disabled' : ''}><legend>Syllable ${i + 1}: ${text(syllable)}</legend>${exercise.options_profile[i].map(contour => `<label class="contour-choice"><input type="radio" name="syllable-${i}" data-syllable="${i}" value="${text(contour)}" ${choices[i] === contour ? 'checked' : ''} required>${text(contour)}</label>`).join('')}</fieldset>`).join('')}</div>
          ${!submitted ? '<button data-submit type="submit" disabled>Check answer</button>' : ''}</form>
          ${submitted ? `<div role="status">${SyllablePitch.review(history[0], this.preferences)}</div><button data-continue>Continue</button>` : ''}` : ''}
        <div class="actions"><button data-end class="secondary">End session</button></div>
        ${history.length ? `<details><summary>Answers this session (${history.length})</summary>${history.map(item => SyllablePitch.review(item, this.preferences)).join('')}</details>` : ''}` : ''}
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
    this.cleanupReviewMedia = SyllablePitch.bindReviewMedia(this.root);
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
