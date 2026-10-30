# Naanala

A minimal Navajo learning site with a FastAPI backend, a syllable-pitch test using dummy audio, local profiles, and user settings (display name, light/dark/device appearance, and increased color contrast). No Navajo recordings are included yet.

## Run locally

Requires Node.js 18+ and Python 3.10+. Create a virtual environment and install the backend dependencies once (already done in this checkout):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

On macOS/Linux use `python3 -m venv .venv` and `.venv/bin/python -m pip install -r requirements.txt`. If a pyenv shim reports no selected version, select an installed Python first or use its full executable path to create the environment.

Run `npm start` and open http://localhost:3000. `server.mjs` selects the project's `.venv` interpreter and launches Uvicorn; Python serves both the frontend and API. No activation, npm install, or frontend build is required. Set `PYTHON` to override the interpreter or `PORT` to override port 3000. Stop the server with Ctrl+C. Restart an old running server after switching to this backend.

Interactive API docs are at http://localhost:3000/docs. Static hosting alone can show the pages but cannot run the exercise API.

Run `npm test` for frontend logic and a live Python API integration test (requires the installed Python dependencies).

## Local profiles

Choose **Sign in**, enter a display name, and continue. Returning with the same name restores that browser's profile and preferences. Sign out leaves the saved profile available for later. These profiles are a development substitute for authentication: anyone using this browser can select them, and they do not sync across devices. No passwords or remote authentication requests are used. Clearing browser storage removes the profiles.

## Settings audit

The legacy settings were compared with the active runtime. Appearance remains available as Light, Dark, or Use device setting. **Prefer Color Contrast** is restored and applies stronger text, borders, and focus indicators across all current pages, including dialogs. Preferences are saved per local profile; existing profiles default to normal contrast.

The following controls depend on archived features and cannot currently affect the app:

| Legacy settings | Missing runtime feature |
| --- | --- |
| Anki field preview, answer/grade keybindings | Flashcards and note editor |
| Dictionary upload, ordering, removal | Dictionary service and database |
| YouTube subtitle keybindings | YouTube player |
| Reader autoplay, delay, scrolling, create-note form | Reader |
| Furigana | Japanese text rendering (pause preferences are available in the new exercise setup) |
| Create Note as Offcanvas | Note editor |
| Horizontal text | Dictionary entry renderer; current app text is already horizontal |
| Word Status | Dictionary and word tracking |
| API token display/regeneration | Authenticated API and token storage |

These controls remain in the legacy reference and should return alongside their corresponding features.

## Where to work

- `web/app.js`: home page, `/tests` route, local profile handling, settings.
- `web/tests/SyllablePitch.js`: editable syllable-pitch test, adapted to plain JavaScript from the archived React component.
- `web/tests/Tests.js`: exercise catalog, categories, setup, session tracking, and previous tests.
- `web/style.css`: responsive layout and themes.
- `backend/app.py`: FastAPI exercise endpoint, generated dummy WAV audio, and public `web/` hosting.
- `server.mjs`: starts the Python backend when running `npm start`.
- `requirements.txt`: Python dependencies.
- `tests/server.test.mjs`: checks the new server.

## Preserved examples

The original application is archived intact in `reference/legacy/`, outside the active runtime. This includes all original learning tests, their supporting data/code, and the original Swift automated test:

- `reference/legacy/Sources/UI/Components/Tests/`: pitch accent and syllabary test UI.
- `reference/legacy/Sources/App/Tests/`: original test controllers and helpers.
- `reference/legacy/Tests/AppTests/AppTests.swift`: original automated test.

The other old sections and their dependencies are also archived so the test examples retain their context. They are not imported, built, or served by the new app. The original package manifests and README are there for reference. The old database, Swift, MeCab, media, dictionary, flashcard, and transcription services are no longer required to run Naanala.

## Working on the first test

Open `#/tests` for square exercise tiles grouped by category. Syllable Pitch is under Pitch; its tile opens `#/tests/syllable-pitch` for options. The page includes a Description panel with expandable instructions, Session and Preferences panels, and a blank Test settings panel. The History tab opens the separate `#/tests/syllable-pitch/history` page; Options returns to setup. Choose tracked or untracked, limited or unlimited, and a question count (1–1000) for limited sessions, then choose Start session. Tracked sessions require a local profile; guests can practice untracked. Settings are remembered per local profile when starting a session.

Previous tests show tracked sessions with their start date, question limit, score, and status. Completed sessions reach their question limit; End session ends practice manually; leaving or reloading marks active sessions Interrupted. Untracked sessions do not enter history. History is browser-local and does not sync to a backend.

The Preferences section saves general exercise preferences immediately to the local profile: Pause After Correct Answers, Pause After Incorrect Answers, Show Pitch Graph During Review, and Play Audio Inline. Guests can change these for the current visit. Graphs are shown only in answer review, from the backend's normalized `pitch` samples; inline audio can be replaced with Replay buttons. A separate Test settings section is intentionally blank for future exercise-specific options.

The separate History page includes overall accuracy, completed/other status filtering, ten sessions per page, duration, category statistics, and expandable per-question review with the chosen answer, correct answer, audio, pitch graph, and response time. Accuracy plots show the latest 30 sessions with answers; activity plots show question totals for the latest 14 practice days. Both follow the status filter and include expandable text data. Empty histories show no invented results. Older summary-only records still work and explicitly indicate that answer details are unavailable. Tracked answers and a snapshot of session preferences are stored with each session.

Edit `web/tests/SyllablePitch.js` to implement exercise behavior. `web/index.html` loads it and `Tests.js` before `app.js`. The Tests route creates a catalog/setup controller, which creates the exercise when Start session is selected. Route changes destroy the instance and cancel its automatic-next-question timer. Add future exercises to the registry at the top of `Tests.js`; category groups and links are generated from it.

The audio player, answer choices, history, statistics, answer replay, and Continue behavior are retained in plain JavaScript. `load()` calls `GET /api/tests/syllable-pitch/random`, which currently returns two labelled dummy choices. The browser randomly selects the correct choice/audio. Low and high tones are generated by Python at `/api/audio/dummy/low.wav` and `/api/audio/dummy/high.wav`. These are synthetic test fixtures, not Navajo syllables. Failed requests show Retry; ending or leaving aborts pending requests.

Replace `syllable_pitch()` in `backend/app.py` with real exercise data when ready. Its response shape is `{ prompt, dummy, pairs: [{ label, category, audio, pitch }] }`. Each pair is a possible answer; the browser's `pairIndex` selects the audio/correct answer. `pitch` is an array of normalized heights from 0 to 1 used during review. Set `dummy` to false when supplying real content. Audio can be placed under `web/audio/` and referenced as `/audio/filename.wav`. Pause defaults are false for correct answers and true for incorrect answers, matching the legacy defaults.
