const storageKey = 'naanala.local.v1';
const emptyState = () => ({ profiles: [], activeId: null });
let state;
try {
  state = JSON.parse(localStorage.getItem(storageKey)) || emptyState();
  if (!Array.isArray(state.profiles)) state = emptyState();
  state.profiles = state.profiles.filter(p => typeof p.id === 'string' && typeof p.name === 'string');
} catch { state = emptyState(); }
// An in-progress record loaded from storage belongs to a page that was closed or reloaded.
let recoveredSessions = false;
for (const profile of state.profiles) {
  if (!Array.isArray(profile.testSessions)) continue;
  for (const session of profile.testSessions) {
    if (session.status === 'In progress') {
      session.status = 'Interrupted';
      recoveredSessions = true;
    }
  }
}

const main = document.querySelector('main');
const dialog = document.querySelector('#login');
const currentUser = () => state.profiles.find(p => p.id === state.activeId);
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
let statusTimer;
let activeTest;
function notify(message) {
  document.querySelector('#status').textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { document.querySelector('#status').textContent = ''; }, 5000);
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); return true; }
  catch { notify('Browser storage is unavailable. Changes will last for this session only.'); return false; }
}
function openLogin() {
  document.querySelector('#login-error').textContent = '';
  document.querySelector('#login-form').reset();
  dialog.showModal();
  document.querySelector('#login-name').focus();
}
function render() {
  activeTest?.destroy();
  activeTest = null;
  const user = currentUser();
  const theme = user?.theme;
  document.documentElement.dataset.theme = ['light','dark','system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.contrast = user?.prefersColorContrast === true ? 'high' : 'normal';
  document.querySelector('#account').textContent = user ? 'Sign out' : 'Sign in';
  const path = location.hash.slice(1) || '/';
  const page = path === '/' ? 'home' : path === '/tests' || path.startsWith('/tests/') ? 'tests' : path === '/settings' ? 'settings' : 'missing';
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${({ home:'Learn Navajo', tests:'Tests', settings:'Settings', missing:'Page not found' })[page]} · Naanala`;
  if (page === 'home') {
    main.innerHTML = `<p class="eyebrow">Your Navajo learning space</p>
      <h1>A new language.<br>One step at a time.</h1>
      <p class="intro">${user ? `Welcome, ${escape(user.name)}. ` : ''}Make room for Navajo in your day.</p>
      <a class="button" href="#/tests">Go to tests <span aria-hidden="true">→</span></a>
      <section class="card"><p class="eyebrow">A fresh start</p><h2>Room to grow</h2><p>Navajo learning material is coming. Your test workspace is ready for the first exercises.</p></section>`;
  } else if (page === 'tests') {
    activeTest = new Tests(main, { path, user, persist, signIn: openLogin });
  } else if (page === 'settings') {
    main.innerHTML = `<p class="eyebrow">Make yourself at home</p><h1>Settings</h1>${user ? `
      <form id="settings-form" class="settings">
        <label for="display-name">Display name</label><input id="display-name" required maxlength="60" value="${escape(user.name)}" autocomplete="nickname">
        <label for="theme">Appearance</label><select id="theme"><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select>
        <label class="checkbox" for="color-contrast"><input id="color-contrast" type="checkbox" aria-describedby="contrast-help" ${user.prefersColorContrast === true ? 'checked' : ''}> Prefer Color Contrast</label>
        <p id="contrast-help">Use stronger text, borders, and focus indicators throughout the app in light or dark mode.</p>
        <div class="actions"><button type="submit">Save settings</button></div>
        <p>Your profile and preferences are saved only in this browser.</p>
      </form>` : '<p>Sign in locally to save your name and appearance preferences.</p><button id="settings-login">Sign in</button>'}`;
    if (user) {
      document.querySelector('#theme').value = ['system','light','dark'].includes(user.theme) ? user.theme : 'system';
      document.querySelector('#settings-form').addEventListener('submit', event => {
        event.preventDefault();
        const input = document.querySelector('#display-name');
        const name = input.value.trim();
        input.setCustomValidity(name ? '' : 'Enter a display name.');
        if (!input.reportValidity()) return;
        user.name = name;
        user.theme = document.querySelector('#theme').value;
        user.prefersColorContrast = document.querySelector('#color-contrast').checked;
        const saved = persist();
        render();
        if (saved) notify('Settings saved.');
      });
      document.querySelector('#display-name').addEventListener('input', event => event.target.setCustomValidity(''));
    } else document.querySelector('#settings-login').addEventListener('click', openLogin);
  } else {
    main.innerHTML = '<h1>Page not found</h1><a href="#/">Return home</a>';
  }
}
document.querySelector('#account').addEventListener('click', () => {
  if (!currentUser()) return openLogin();
  state.activeId = null;
  persist();
  render();
});
document.querySelector('#cancel-login').addEventListener('click', () => dialog.close());
document.querySelector('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = document.querySelector('#login-name').value.trim();
  if (!name) { document.querySelector('#login-error').textContent = 'Enter a display name.'; return; }
  let user = state.profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!user) {
    user = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, theme:'system' };
    state.profiles.push(user);
  }
  state.activeId = user.id;
  persist();
  dialog.close();
  render();
});
window.addEventListener('hashchange', () => { render(); main.focus(); });
// Device appearance is handled in CSS; avoid interrupting an active test on a theme change.
render();
if (recoveredSessions) persist();
