# Naanala

A Navajo learning site with a FastAPI backend, a syllable-pitch test using local OGG recordings and metadata, local profiles, and user settings (display name, light/dark/device appearance, and increased color contrast).

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

The Preferences section saves general exercise preferences immediately to the local profile: Pause After Correct Answers, Pause After Incorrect Answers, Show Pitch Graph During Review, and Play Audio Inline. Guests can change these for the current visit. Pitch graphs show expected H/L contours during review; inline audio can be replaced with Replay buttons. A separate Test settings section is intentionally blank for future exercise-specific options.

The separate History page includes overall accuracy, completed/other status filtering, ten sessions per page, duration, category statistics, and expandable per-question review with the chosen answer, correct answer, audio, pitch graph, and response time. Accuracy plots show the latest 30 sessions with answers; activity plots show question totals for the latest 14 practice days. Both follow the status filter and include expandable text data. Empty histories show no invented results. Older summary-only records still work and explicitly indicate that answer details are unavailable. Tracked answers and a snapshot of session preferences are stored with each session.

Edit `web/tests/SyllablePitch.js` to implement exercise behavior. `web/index.html` loads it and `Tests.js` before `app.js`. The Tests route creates a catalog/setup controller, which creates the exercise when Start session is selected. Route changes destroy the instance and cancel its automatic-next-question timer. Add future exercises to the registry at the top of `Tests.js`; category groups and links are generated from it.

`load()` calls `GET /api/tests/syllable-pitch/random` and validates `syllables_no_pitch: string[]`, `tone_profile: string[]`, `options_profile: string[][]`, `word: string`, and `audio_id: string`. The array lengths must agree and each correct contour must be an offered option. Each syllable has a separate radio group; Check answer requires all groups to be answered. Review marks each syllable individually. A question counts as correct only when every syllable is correct, and session limits count whole questions. The accented word is revealed after submission.

The backend reads `backend/metadata.csv` and generates `options_profile` for each syllable. Rows with missing audio or incompatible syllable/contour metadata are excluded without editing the CSV. Audio IDs are unique filename stems, resolved through a server-side allowlist; filesystem paths are never returned. `GET /api/audio/{audio_id}` serves OGG recordings with range support. Unknown IDs return 404.

The browser decodes the OGG using Web Audio and estimates fundamental frequency (F0, 60?600 Hz) using a YIN-style periodicity detector with recording-relative silence detection and a speech-tolerant confidence threshold. Very short pitch-consistent dropouts can be bridged; long gaps remain unvoiced. The Hz-versus-time curve is shown only after submitting an answer and when Show Pitch Graph During Review is enabled. Silence and uncertain frames remain gaps. This estimate can contain tracking or octave errors; it does not replace the annotated H/L contours. Frequency data and per-syllable results are saved with tracked answers for later review. If decoding or pitch detection is unavailable, review displays an unavailable message and native playback is still offered. Browsers must support the recording's OGG codec for playback. Dummy tone endpoints remain available separately.

Review frequency graphs include a playhead and shaded progress synchronized to the associated recording, graph click-to-seek, a keyboard-accessible seek slider, and a playback time readout. These work with inline players and Play recording buttons, including saved history. Playback synchronization uses the media current time and animation frames; leaving or changing the review stops playback and removes listeners. The archived Japanese minimal-pairs component contains static accent notation and native audio, rather than this synchronized frequency player.
