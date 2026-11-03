// Add exercises here; the catalog groups them automatically by category.
const exercises = [
  { pitchSettings: true, id: 'syllable-pitch', category: 'Vowels', name: 'Syllable Pitch',
    description: 'Listen to a syllable and identify its pitch.',
    details: 'Listen to the recording and choose a pitch contour for each syllable. H means high and L means low. Check your answer to see which syllables were correct. The whole question counts as correct only when every syllable is correct. After answering, review can show the estimated pitch frequency in Hz and the expected pitch contours.',
    review: (answer, preferences) => SyllablePitch.review(answer, preferences),
    create: (root, options) => new SyllablePitch(root, options) },
  { id: 'syllable-nasal', category: 'Vowels', name: 'Syllable Nasality',
    description: 'Listen to a syllable and identify whether it is nasal or oral.',
    details: 'Listen to the recording and choose whether each syllable is nasal or oral. Check your answer to see which syllables were correct. The whole question counts as correct only when every syllable is correct. After answering, review can show the expected nasality of each syllable.',
    review: (answer, preferences) => SyllableNasality.review(answer, preferences),
    create: (root, options) => new SyllableNasality(root, options) },
  { lengthSettings: true, id: 'vowel-length', category: 'Vowels', name: 'Vowel Length',
    description: 'Distinguish short vowels, long vowels, and diphthongs.',
    details: 'Choose between two spellings with the same consonants, tone, and nasality. Select any of four vowel contrasts below. Tone and nasality are disclosed for each tested syllable. Syllables that cannot preserve the same tone across both choices are not tested.',
    review: (answer, preferences) => VowelLength.review(answer, preferences),
    create: (root, options) => new VowelLength(root, options) }
];

class Tests {
  static pitchProfiles = ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels', 'flat', 'rising', 'descending'];
  static profileLabels = {
    monophthongs: 'Monophthongs',
    diphthongs_long_vowels: 'Diphthongs / long vowels',
    triphthongs_diphthongs_with_long_vowels: 'Triphthongs / diphthongs with long vowels',
    flat: 'Flat', rising: 'Rising', descending: 'Descending'
  };
  constructor(root, { path, user, persist, signIn }) {
    this.root = root;
    this.user = user;
    this.persist = persist;
    this.signIn = signIn;
    this.preferences = { pauseAfterCorrect: false, pauseAfterIncorrect: true, showPitchGraph: true };
    this.pitchProfiles = [...Tests.pitchProfiles];
    for (const key of Object.keys(this.preferences)) {
      if (typeof user?.testPreferences?.[key] === 'boolean') this.preferences[key] = user.testPreferences[key];
    }
    this.historyPage = 0;
    this.historyFilter = 'all';
    this.text = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const [, , id, action] = path.split('/');
    this.exercise = exercises.find(item => item.id === id);
    const savedProfiles = user?.exerciseSettings?.[id]?.profiles;
    if (Array.isArray(savedProfiles) && savedProfiles.every(profile => Tests.pitchProfiles.includes(profile))) {
      this.pitchProfiles = Tests.pitchProfiles.filter(profile => savedProfiles.includes(profile));
    }
    this.lengthContrasts = Object.keys(this.exercise?.lengthSettings ? VowelLength.contrasts : {});
    const savedContrasts = user?.exerciseSettings?.[id]?.contrasts;
    if (this.exercise?.lengthSettings && Array.isArray(savedContrasts)) {
      this.lengthContrasts = this.lengthContrasts.filter(key => savedContrasts.includes(key));
    }
    if (!id) this.catalog();
    else if (!this.exercise || (action && action !== 'history')) root.innerHTML = '<h1>Exercise not found</h1><a href="#/tests">Back to tests</a>';
    else if (action === 'history') this.history();
    else this.setup();
  }

  catalog() {
    this.root.innerHTML = `<p class="eyebrow">Practice by exercise</p><h1>Tests</h1>
      <p>Choose an exercise, set up your session, and follow your progress.</p>
      ${[...new Set(exercises.map(item => item.category))].map(category => `
        <section class="exercise-category"><h2>${this.text(category)}</h2><div class="exercise-grid">
        ${exercises.filter(item => item.category === category).map(item => `
          <a class="exercise-tile" href="#/tests/${item.id}"><span class="eyebrow">${this.text(category)}</span>
          <h3>${this.text(item.name)}</h3><p>${this.text(item.description)}</p><span>Set up session →</span></a>`).join('')}
        </div></section>`).join('')}`;
  }

  heading(active) {
    const base = `#/tests/${this.exercise.id}`;
    return `<div class="exercise-heading"><div><p class="eyebrow">Tests · ${this.text(this.exercise.category)}</p><h1>${this.text(this.exercise.name)}</h1></div>
      <div class="actions"><a class="button secondary" href="#/tests">← Back to tests</a></div></div>
      <nav class="exercise-tabs" aria-label="Exercise pages"><a href="${base}" ${active === 'options' ? 'aria-current="page"' : ''}>Options</a><a href="${base}/history" ${active === 'history' ? 'aria-current="page"' : ''}>History</a></nav>`;
  }

  history() {
    this.root.innerHTML = `${this.heading('history')}<h2 class="history-title">Session history</h2><p>Review your tracked sessions and how your results change over time.</p><section id="test-history"></section>`;
    this.renderHistory();
  }

  setup() {
    this.session?.destroy();
    this.session = null;
    const exercise = this.exercise;
    const options = this.user?.exerciseSettings?.[exercise.id] || { tracked: !!this.user, mode: 'limited', count: 20 };
    this.root.innerHTML = `${this.heading('options')}
      <section class="exercise-description panel"><h2>Description</h2><p>${this.text(exercise.description)}</p><details><summary>More about this test</summary><p>${this.text(exercise.details)}</p></details></section>
      <div class="exercise-setup"><section class="panel"><h2>Session</h2>
      <form id="session-settings">
        <label for="tracking">Tracking</label><select id="tracking">
          <option value="untracked">Untracked — practice without saving</option>
          <option value="tracked" ${!this.user ? 'disabled' : ''}>Tracked — save to my local history</option>
        </select>
        <p>${this.user ? 'Tracked sessions are saved to your profile in this browser only.' : 'Sign in to track sessions and view your history. You can practice without signing in.'}</p>
        ${!this.user ? '<button type="button" class="secondary" data-sign-in>Sign in</button>' : ''}
        <label for="session-mode">Session length</label><select id="session-mode"><option value="limited">Limited</option><option value="unlimited">Unlimited</option></select>
        <div id="question-count"><label for="session-count">Number of questions</label><input id="session-count" type="number" min="1" max="1000" step="1" required value="${Number.isInteger(options.count) ? options.count : 20}"></div>
        <p id="session-description" aria-live="polite"></p>
        <p>One question is one recording. Choose an answer for every syllable, then check your answer. All syllables must be right for the question to count as correct.</p>
      </form></section>
      <section class="preferences panel"><h2>Preferences</h2><p>General preferences saved to your ${this.user ? 'local account in this browser.' : 'current visit. Sign in to save them to your account.'}</p>
      ${Object.entries({ pauseAfterCorrect: 'Pause After Correct Answers', pauseAfterIncorrect: 'Pause After Incorrect Answers', ...(exercise.pitchSettings ? { showPitchGraph: 'Show Pitch Graph During Review' } : {}) }).map(([key, label]) => `<label class="checkbox"><input type="checkbox" data-preference="${key}" ${this.preferences[key] ? 'checked' : ''}>${label}</label>`).join('')}
      <p id="preference-status" role="status"></p></section>
      ${exercise.pitchSettings ? `<section class="test-settings panel"><h2>Test settings</h2><p>Vowel and pitch categories</p>
      ${Tests.pitchProfiles.map(profile => `<label class="checkbox"><input type="checkbox" data-pitch-profile="${profile}" ${this.pitchProfiles.includes(profile) ? 'checked' : ''}>${Tests.profileLabels[profile]}</label>`).join('')}
      <p data-profile-status role="status"></p></section>` : ''}
      ${exercise.lengthSettings ? `<section class="test-settings panel"><h2>Vowel contrasts</h2>
      ${Object.entries(VowelLength.contrasts).map(([key, label]) => `<label class="checkbox"><input type="checkbox" data-length-contrast="${key}" ${this.lengthContrasts.includes(key) ? 'checked' : ''}>${this.text(label)}</label>`).join('')}
      <p data-length-status role="status"></p></section>` : ''}</div>
      <div class="actions"><button data-start-session type="submit" form="session-settings" aria-describedby="category-validation">Start session</button></div>
      <p id="category-validation" role="status"></p>`;
    const query = selector => this.root.querySelector(selector);
    const validCategories = () => exercise.lengthSettings ? this.lengthContrasts.length > 0 : !exercise.pitchSettings ||
      ['flat', 'rising', 'descending'].filter(profile => this.pitchProfiles.includes(profile)).length >= 2 &&
      ['monophthongs', 'diphthongs_long_vowels', 'triphthongs_diphthongs_with_long_vowels'].some(profile => this.pitchProfiles.includes(profile));
    const updateStart = () => {
      if (exercise.lengthSettings) {
        const valid = validCategories();
        query('[data-start-session]').disabled = !valid;
        query('#category-validation').textContent = valid ? '' : 'Select at least one vowel contrast.';
        return;
      }
      if (!exercise.pitchSettings) return;
      const flatEnabled = this.pitchProfiles.includes('flat');
      if (!flatEnabled) this.pitchProfiles = this.pitchProfiles.filter(profile => profile !== 'monophthongs');
      const monophthongs = query('[data-pitch-profile="monophthongs"]');
      monophthongs.disabled = !flatEnabled;
      monophthongs.checked = this.pitchProfiles.includes('monophthongs');
      const valid = validCategories();
      query('[data-start-session]').disabled = !valid;
      query('#category-validation').textContent = valid ? '' : 'Select at least one vowel category and at least two of Flat, Rising, and Descending.';
    };
    updateStart();
    this.root.querySelectorAll('[data-length-contrast]').forEach(input => input.addEventListener('change', () => {
      const selected = new Set(this.lengthContrasts);
      if (input.checked) selected.add(input.dataset.lengthContrast);
      else selected.delete(input.dataset.lengthContrast);
      this.lengthContrasts = Object.keys(VowelLength.contrasts).filter(key => selected.has(key));
      updateStart();
      if (this.user) {
        this.user.exerciseSettings ||= {};
        this.user.exerciseSettings[exercise.id] = { ...options, ...this.user.exerciseSettings[exercise.id], contrasts: [...this.lengthContrasts] };
        const saved = this.persist();
        query('[data-length-status]').textContent = saved === false ? 'Storage unavailable; settings apply for this visit.' : 'Test settings saved.';
      }
    }));
    this.root.querySelectorAll('[data-pitch-profile]').forEach(input => input.addEventListener('change', () => {
      const selected = new Set(this.pitchProfiles);
      if (input.checked) selected.add(input.dataset.pitchProfile);
      else selected.delete(input.dataset.pitchProfile);
      this.pitchProfiles = Tests.pitchProfiles.filter(profile => selected.has(profile));
      updateStart();
      if (this.user) {
        this.user.exerciseSettings ||= {};
        this.user.exerciseSettings[exercise.id] = { ...options, ...this.user.exerciseSettings[exercise.id], profiles: [...this.pitchProfiles] };
        const saved = this.persist();
        query('[data-profile-status]').textContent = saved === false ? 'Storage unavailable; settings apply for this visit.' : 'Test settings saved.';
      }
    }));
    this.root.querySelectorAll('[data-preference]').forEach(input => input.addEventListener('change', () => {
      this.preferences[input.dataset.preference] = input.checked;
      if (this.user) {
        this.user.testPreferences = { ...this.preferences };
        const saved = this.persist();
        query('#preference-status').textContent = saved === false ? 'Storage unavailable; preferences apply for this visit.' : 'Preferences saved.';
      }
    }));
    query('#tracking').value = this.user && options.tracked ? 'tracked' : 'untracked';
    query('#session-mode').value = options.mode === 'unlimited' ? 'unlimited' : 'limited';
    const describe = () => {
      const unlimited = query('#session-mode').value === 'unlimited';
      query('#question-count').hidden = unlimited;
      query('#session-count').disabled = unlimited;
      query('#session-description').textContent = `${query('#tracking').value === 'tracked' ? 'Tracked' : 'Untracked'} session · ${unlimited ? 'Continue until you end the session.' : 'Finish after the selected number of questions.'}`;
    };
    query('#session-mode').addEventListener('change', describe);
    query('#tracking').addEventListener('change', describe);
    query('[data-sign-in]')?.addEventListener('click', this.signIn);
    describe();
    query('#session-settings').addEventListener('submit', event => {
      event.preventDefault();
      if (!validCategories()) return;
      const mode = query('#session-mode').value;
      const count = Number(query('#session-count').value);
      if (mode === 'limited' && (!Number.isInteger(count) || count < 1 || count > 1000)) return;
      const tracked = !!this.user && query('#tracking').value === 'tracked';
      if (this.user) {
        this.user.exerciseSettings ||= {};
        this.user.exerciseSettings[exercise.id] = { tracked, mode, count: Number.isInteger(count) ? count : 20, profiles: [...this.pitchProfiles], ...(exercise.lengthSettings ? { contrasts: [...this.lengthContrasts] } : {}) };
        this.persist();
      }
      this.startSession({ tracked, limit: mode === 'limited' ? count : null });
    });
  }

  startSession({ tracked, limit }) {
    const record = { exerciseId: this.exercise.id, startedAt: new Date().toISOString(), limit, answered: 0, correct: 0, status: 'In progress', answers: [], preferences: { ...this.preferences } };
    if (tracked) {
      if (!Array.isArray(this.user.testSessions)) this.user.testSessions = [];
      this.user.testSessions.push(record);
      this.persist();
    }
    this.session = this.exercise.create(this.root, {
      limit, tracked, profiles: [...this.pitchProfiles], contrasts: [...this.lengthContrasts], preferences: { ...this.preferences },
      onSessionReady: ({ limit }) => {
        record.limit = limit;
        if (tracked) this.persist();
      },
      onProgress: ({ answered, correct, answer }) => {
        Object.assign(record, { answered, correct });
        if (answer) record.answers.push(answer);
        if (tracked) this.persist();
      },
      onFinish: status => {
        record.status = status;
        record.endedAt = new Date().toISOString();
        if (tracked) this.persist();
      },
      onBack: () => this.setup()
    });
    this.session.start();
  }

  plots(sessions) {
    const text = this.text;
    const scored = sessions.filter(item => item.answered > 0).slice(-30);
    if (!scored.length) return '<p>Plots will appear after you answer questions in a tracked session.</p>';
    const x = (index, length) => length === 1 ? 280 : 48 + index * 464 / (length - 1);
    const accuracy = item => Math.round(item.correct / item.answered * 100);
    const points = scored.map((item, index) => `${x(index, scored.length)},${170 - accuracy(item) * 1.4}`).join(' ');
    const days = new Map();
    for (const item of sessions) {
      const date = new Date(item.startedAt);
      if (!Number.isFinite(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const day = days.get(key) || { label: date.toLocaleDateString(), count: 0 };
      day.count += Number(item.answered) || 0;
      days.set(key, day);
    }
    const activity = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([, day]) => day);
    const maximum = Math.max(1, ...activity.map(day => day.count));
    return `<div class="history-plots">
      <figure class="panel"><figcaption><h3>Accuracy by session</h3><p>Latest ${scored.length} sessions with answers, oldest to newest.</p></figcaption>
      <svg viewBox="0 0 560 220" role="img" aria-label="Accuracy by session, from zero to one hundred percent">
        ${[0, 50, 100].map(value => `<path class="plot-grid" d="M48 ${170 - value * 1.4} H520"/><text x="2" y="${175 - value * 1.4}">${value}%</text>`).join('')}
        <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/>
        ${scored.map((item, index) => `<circle tabindex="0" cx="${x(index, scored.length)}" cy="${170 - accuracy(item) * 1.4}" r="5"><title>${text(new Date(item.startedAt).toLocaleString())}: ${accuracy(item)}% (${item.correct}/${item.answered})</title></circle>`).join('')}
        <text x="48" y="205">${text(new Date(scored[0].startedAt).toLocaleDateString())}</text><text x="512" y="205" text-anchor="end">${text(new Date(scored.at(-1).startedAt).toLocaleDateString())}</text>
      </svg><details><summary>View accuracy data</summary><ul>${scored.map(item => `<li>${text(new Date(item.startedAt).toLocaleString())}: ${accuracy(item)}%</li>`).join('')}</ul></details></figure>
      <figure class="panel"><figcaption><h3>Practice activity</h3><p>Questions answered on the latest ${activity.length} practice days.</p></figcaption>
      <svg viewBox="0 0 560 220" role="img" aria-label="Questions answered by practice day">
        <path class="plot-grid" d="M48 30 V170 H520"/><text x="4" y="35">${maximum}</text><text x="20" y="175">0</text>
        ${activity.map((day, index) => { const width = 464 / activity.length; const height = day.count / maximum * 140;
          return `<rect tabindex="0" x="${48 + index * width + width * .15}" y="${170 - height}" width="${width * .7}" height="${height}"><title>${text(day.label)}: ${day.count} questions</title></rect>`;
        }).join('')}
        <text x="48" y="205">${text(activity[0]?.label)}</text><text x="512" y="205" text-anchor="end">${text(activity.at(-1)?.label)}</text>
      </svg><details><summary>View activity data</summary><ul>${activity.map(day => `<li>${text(day.label)}: ${day.count} questions</li>`).join('')}</ul></details></figure></div>`;
  }

  renderHistory() {
    this.cleanupReviewMedia?.();
    this.root.querySelectorAll('audio').forEach(audio => audio.pause());
    const target = this.root.querySelector('#test-history');
    const text = this.text;
    const all = (Array.isArray(this.user?.testSessions) ? this.user.testSessions : []).filter(item => item.exerciseId === this.exercise.id);
    const answered = all.reduce((sum, item) => sum + (item.answered || 0), 0);
    const correct = all.reduce((sum, item) => sum + (item.correct || 0), 0);
    const filtered = all.filter(item => this.historyFilter === 'all' || (this.historyFilter === 'Completed' ? item.status === 'Completed' : item.status !== 'Completed')).slice().reverse();
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    this.historyPage = Math.min(this.historyPage, pages - 1);
    const duration = item => {
      if (!item.endedAt) return '—';
      const seconds = Math.max(0, Math.round((new Date(item.endedAt) - new Date(item.startedAt)) / 1000));
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    };
    target.innerHTML = `<h2>Previous tests</h2>${!this.user ? '<p>Sign in to see your tracked sessions.</p>' : !all.length ? '<p>No tracked sessions yet.</p>' : `
      <p>${all.length} sessions · ${answered} answers · ${answered ? Math.round(correct / answered * 100) : 0}% overall accuracy</p>
      <label for="history-filter">Show sessions</label><select id="history-filter"><option value="all">All sessions</option><option value="Completed">Completed</option><option value="other">Ended / interrupted / in progress</option></select>
      ${this.plots(filtered.slice().reverse())}
      <div class="history-scroll"><table><thead><tr><th>Started</th><th>Length</th><th>Score</th><th>Accuracy</th><th>Duration</th><th>Status</th></tr></thead><tbody>
      ${filtered.slice(this.historyPage * 10, (this.historyPage + 1) * 10).map(item => `<tr><td><details><summary>${text(new Date(item.startedAt).toLocaleString())}</summary>
        <p>Length: ${item.limit === null ? 'Unlimited' : text(item.limit)} · Score: ${text(item.correct)} / ${text(item.answered)} · Accuracy: ${item.answered ? Math.round(item.correct / item.answered * 100) : 0}% · Duration: ${duration(item)}</p>
        ${Array.isArray(item.answers) && item.answers.length ? `<h3>Category statistics</h3>${[...new Set(item.answers.map(answer => answer.type))].map(type => {
          const group = item.answers.filter(answer => answer.type === type);
          return `<p>${text(type)}: ${group.filter(answer => answer.correct).length} / ${group.length}</p>`;
        }).join('')}<h3>Answer review</h3>${item.answers.map((answer, i) => `<details><summary>Question ${i + 1}: ${answer.correct ? 'Correct' : 'Incorrect'}</summary>${this.exercise.review(answer, this.preferences)}</details>`).join('')}` : '<p>Detailed answers were not recorded for this session.</p>'}
      </details></td><td>${item.limit === null ? 'Unlimited' : text(item.limit)}</td><td>${text(item.correct)} / ${text(item.answered)}</td><td>${item.answered ? Math.round(item.correct / item.answered * 100) : 0}%</td><td>${duration(item)}</td><td>${text(item.status)}</td></tr>`).join('')}
      </tbody></table></div>${!filtered.length ? '<p>No matching sessions.</p>' : ''}
      <div class="actions"><button data-history-prev ${this.historyPage === 0 ? 'disabled' : ''}>Previous</button><span>Page ${this.historyPage + 1} of ${pages}</span><button data-history-next ${this.historyPage >= pages - 1 ? 'disabled' : ''}>Next</button></div><audio data-history-player hidden></audio>`}`;
    const filter = this.root.querySelector('#history-filter');
    if (filter) {
      filter.value = this.historyFilter;
      filter.addEventListener('change', () => { this.historyFilter = filter.value; this.historyPage = 0; this.renderHistory(); });
    }
    this.root.querySelector('[data-history-prev]')?.addEventListener('click', () => { this.historyPage = Math.max(0, this.historyPage - 1); this.renderHistory(); });
    this.root.querySelector('[data-history-next]')?.addEventListener('click', () => { this.historyPage = Math.min(pages - 1, this.historyPage + 1); this.renderHistory(); });
    this.root.querySelectorAll('[data-replay]').forEach(button => button.addEventListener('click', () => {
      const audio = this.root.querySelector('[data-history-player]');
      audio.src = button.dataset.replay;
      audio.play().catch(() => {});
    }));
    this.cleanupReviewMedia = Exercise.bindReviewMedia(this.root);
  }

  destroy() {
    this.cleanupReviewMedia?.();
    this.session?.destroy();
    this.root.querySelectorAll('audio').forEach(audio => audio.pause());
  }
}
