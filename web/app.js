const storageKey = 'naanala.local.v1';
const emptyState = () => ({ profiles: [] });
let state;
try {
  state = JSON.parse(localStorage.getItem(storageKey)) || emptyState();
  if (!Array.isArray(state.profiles)) state = emptyState();
  state.profiles = state.profiles.filter(p => typeof p.id === 'string' && typeof p.name === 'string');
} catch { state = emptyState(); }
delete state.activeId;
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
const accountButton = document.querySelector('#account');
let currentUser = null;
let accountReady = false;
let authPending = false;
let registering = false;
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
function setAuthMode(create) {
  registering = create;
  const title = create ? 'Create an account' : 'Sign in';
  document.querySelector('#login-title').textContent = title;
  document.querySelector('#submit-auth').textContent = title;
  document.querySelector('#switch-auth').textContent = create ? 'Back to sign in' : 'Create an account';
  const password = document.querySelector('#login-password');
  password.autocomplete = create ? 'new-password' : 'current-password';
  password.minLength = create ? 12 : 1;
  password.value = '';
  document.querySelector('#registration-help').hidden = !create;
  document.querySelector('#login-error').textContent = '';
}
function openLogin() {
  if (!accountReady || authPending) return;
  document.querySelector('#login-form').reset();
  setAuthMode(false);
  dialog.showModal();
  document.querySelector('#login-name').focus();
}
function useAccount(account) {
  let profile = state.profiles.find(p => p.id === account.id);
  if (!profile) {
    profile = { id: account.id, name: account.username, theme: 'system' };
    state.profiles.push(profile);
    persist();
  }
  currentUser = profile;
}
function authRequest(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
function render() {
  activeTest?.destroy();
  activeTest = null;
  const user = currentUser;
  const theme = user?.theme;
  document.documentElement.dataset.theme = ['light','dark','system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.contrast = user?.prefersColorContrast === true ? 'high' : 'normal';
  accountButton.textContent = user ? 'Sign out' : 'Sign in';
  accountButton.disabled = !accountReady || authPending;
  const path = location.hash.slice(1) || '/';
  const page = path === '/' ? 'home' : path === '/tests' || path.startsWith('/tests/') ? 'tests' : path === '/settings' ? 'settings' : 'missing';
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${({ home:'Learn Navajo', tests:'Tests', settings:'Settings', missing:'Page not found' })[page]} · Naanala`;
  if (page === 'home') {
    main.innerHTML = `<h1>One more tool to learn Navajo</h1>
      <p>Practice Navajo pronunciation with listening exercises on pitch, nasality, vowel length, and consonant aspiration.</p>
      <a class="button" href="#/tests">Browse tests</a>`;
  } else if (page === 'tests') {
    activeTest = new Tests(main, { path, user, persist, signIn: openLogin });
  } else if (page === 'settings') {
    main.innerHTML = `<h1>Settings</h1>${user ? `
      <form id="settings-form" class="settings">
        <label for="display-name">Display name</label><input id="display-name" required maxlength="60" value="${escape(user.name)}" autocomplete="nickname">
        <label for="theme">Appearance</label><select id="theme"><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select>
        <label class="checkbox" for="color-contrast"><input id="color-contrast" type="checkbox" aria-describedby="contrast-help" ${user.prefersColorContrast === true ? 'checked' : ''}> Prefer Color Contrast</label>
        <p id="contrast-help">Use stronger text, borders, and focus indicators throughout the app in light or dark mode.</p>
        <div class="actions"><button type="submit">Save settings</button></div>
        <p>Your profile and preferences are saved only in this browser.</p>
      </form>` : '<p>Sign in to save your name and appearance preferences in this browser.</p><button id="settings-login">Sign in</button>'}`;
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
accountButton.addEventListener('click', async () => {
  if (!currentUser) return openLogin();
  if (authPending) return;
  authPending = true;
  accountButton.disabled = true;
  try {
    const response = await authRequest('/api/auth/logout', {});
    if (!response.ok) throw new Error('Sign-out failed.');
    currentUser = null;
  } catch {
    notify('Could not sign out. Try again.');
  } finally {
    authPending = false;
    if (currentUser) accountButton.disabled = false;
    else render();
  }
});
document.querySelector('#cancel-login').addEventListener('click', () => dialog.close());
document.querySelector('#switch-auth').addEventListener('click', () => setAuthMode(!registering));
dialog.addEventListener('cancel', event => {
  if (authPending) event.preventDefault();
});
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (authPending) return;
  const error = document.querySelector('#login-error');
  const controls = ['#submit-auth', '#switch-auth', '#cancel-login'].map(selector => document.querySelector(selector));
  error.textContent = '';
  authPending = true;
  controls.forEach(control => { control.disabled = true; });
  try {
    const response = await authRequest(registering ? '/api/auth/register' : '/api/auth/login', {
      username: document.querySelector('#login-name').value.trim(),
      password: document.querySelector('#login-password').value
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      error.textContent = typeof payload.detail === 'string' ? payload.detail : 'Could not continue. Try again.';
      return;
    }
    useAccount(await response.json());
    document.querySelector('#login-form').reset();
    dialog.close();
  } catch {
    error.textContent = 'Could not reach the sign-in service. Try again.';
  } finally {
    authPending = false;
    controls.forEach(control => { control.disabled = false; });
    if (currentUser) render();
  }
});
window.addEventListener('hashchange', () => { render(); main.focus(); });
if (recoveredSessions) persist();
async function restoreAccount() {
  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    if (response.ok) useAccount(await response.json());
    else if (response.status !== 401) throw new Error('Account lookup failed.');
  } catch {
    notify('Could not check your sign-in. Try again.');
  } finally {
    accountReady = true;
    render();
  }
}
render();
restoreAccount();
