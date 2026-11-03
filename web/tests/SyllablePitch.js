// Pitch-specific API contract, categories, and visualizations.
class SyllablePitch extends Exercise {
  static title = 'Syllable Pitch';
  static endpoint = '/api/tests/syllable-pitch/session';
  static syllablesField = 'syllables_no_pitch';
  static profileField = 'tone_profile';
  static originalField = 'original_tone_profile';
  static answerLabel = 'contour';
  static instructions = 'Listen, then choose one contour for each syllable. H = high, L = low.';
  static validChoice = value => /^[HL]+$/.test(value);
  static choiceLabel = value => value;
  static validateExercise = value => Exercise.validateExercise(value, SyllablePitch);
  static review = (item, preferences) => Exercise.review(item, preferences, SyllablePitch);
  static answerGraph = value => SyllablePitch.contourGraph(value);

  answerDetails() { return { pitchTrack: this.state.recordingAnalysis }; }

  sessionSettings() {
    const categories = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
    const selected = this.options.profiles ?? categories;
    return Object.fromEntries(categories.map(category => [category, selected.includes(category)]));
  }

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

  static contourGraph(contour) {
    const samples = [...contour].map(tone => tone === 'H' ? 12 : 46);
    if (!samples.length) return '';
    const points = samples.length === 1 ? `8,${samples[0]} 152,${samples[0]}` : samples.map((height, i) => `${8 + i * 144 / (samples.length - 1)},${height}`).join(' ');
    return `<svg class="pitch-graph" viewBox="0 0 160 60" role="img" aria-label="${SyllablePitch.text(contour)} pitch contour"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/></svg>`;
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

}
