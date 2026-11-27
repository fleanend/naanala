# Naanala

A Navajo learning site with a FastAPI backend, pronunciation exercises, and PostgreSQL accounts.

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

## Python tests and coverage

Install the development dependencies and run Green from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m green tests
```

With the virtual environment activated, you can also run `green tests`. Green reads
`.green` automatically and reports line and branch coverage for all Python files
under `backend`, including files that were never imported. Missing line numbers
appear in the terminal report. Plain `python -m unittest` does not enable this
Green configuration.

To generate a browsable report after running the tests:

```powershell
.\.venv\Scripts\python.exe -m coverage html
```

Open `htmlcov/index.html` to inspect coverage per source line. Coverage output is
ignored by Git. Placeholder tests that do not execute backend code report 0%
coverage and may produce a "No data was collected" warning.

## Accounts

Choose **Sign in** to log in or create an account. FastAPI stores Argon2id password hashes and manages 14-day sessions using an HTTP-only cookie. Display name, appearance, and shared exercise preferences follow your account. Existing browser preferences for that same account seed its settings on first sign-in after upgrading. Tracked practice history and per-exercise options stay in the browser. Guests can still practice without tracking.

## PostgreSQL for local development

Docker Compose runs PostgreSQL 17 on the same host as FastAPI. The database
listens on host loopback, and a named volume preserves the data across container
restarts and replacements. Without `DATABASE_URL`, local FastAPI runs in
guest-only mode.

1. Copy `.env.example` to `.env` and set two distinct, randomly generated
   passwords. Use URL-safe characters for the app password, or URL-encode it
   in the connection string. Change `NAANALA_DB_PORT` if port 5432 is in use.
2. Run `docker compose up -d --wait db`.
3. Verify that the app role can read the tables over TCP. The command prompts
   for `NAANALA_DB_PASSWORD`.

   ```sh
   docker compose exec db psql -h 127.0.0.1 -U naanala_app -d naanala -W -c "SELECT count(*) FROM auth.accounts; SELECT count(*) FROM auth.sessions;"
   ```

4. Set `DATABASE_URL` in the shell that starts FastAPI. Replace
   `APP_PASSWORD` and adjust the port if you changed it.

   ```powershell
   $env:DATABASE_URL = 'postgresql://naanala_app:APP_PASSWORD@127.0.0.1:5432/naanala'
   npm.cmd start
   ```

   On macOS/Linux, run
   `DATABASE_URL='postgresql://naanala_app:APP_PASSWORD@127.0.0.1:5432/naanala' npm start`.

The SQL file initializes a fresh volume only. Changing `.env` after
initialization requires rotating the corresponding database role passwords
separately. To upgrade an existing Compose database for account settings,
run these commands before restarting FastAPI:

```powershell
docker compose up -d --wait db
docker compose exec -T db psql -U postgres -d naanala -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/003-settings.sql
```

For a live deployment,
schedule off-host backups and test restores. To create a full database dump
inside the container and copy it to the host, run:

```sh
docker compose exec -T db pg_dump -U postgres -Fc -f /tmp/naanala.dump naanala
docker compose cp db:/tmp/naanala.dump ./naanala.dump
```

Keep dumps outside the repository in protected backup storage. A restore into
a new cluster also needs the `naanala_app` role for the saved grants.

## Deploy on Render

`render.yaml` defines a Free Python web service and a private Free
PostgreSQL database. Render supplies the database's internal
`DATABASE_URL` to FastAPI. At startup, FastAPI creates the auth schema and
its tables if they are missing. It waits up to 20 seconds for an initial
connection and logs when the authentication database is ready. Render probes
`/healthz` to check PostgreSQL connectivity before routing traffic to the new
deploy and while it runs. Cookies on Render require HTTPS.

1. If your existing Render service has a different name or region, update
   the service name and set both regions in `render.yaml` to match before
   pushing. The checked-in values are `naanala` and Oregon.
2. Push to the branch connected to Render. In the Render Dashboard, select
   **New → Blueprint** and connect the repository and branch. If the repo
   already has a Blueprint, use that Blueprint to sync the update.
3. Confirm that both resources show the Free plan in the preview, then apply
   it. Later commits to the linked branch deploy automatically. Once the
   deploy is live, register an account, reload, and verify that you stay
   signed in.

The web service can spin down while idle. The database persists separately
and expires after 30 days. Render allows one active Free PostgreSQL database
per workspace. If you already have one, connect the web service to it using
the manual setup below. See [Render's Free tier limits](https://render.com/docs/free).

If you manage the existing web service manually, select the Free plan for
the web service and use a Free Render Postgres database in the same region.
Set `DATABASE_URL` to its **Internal Database URL** in the web
service's **Environment** tab, and use the build and start commands from
`render.yaml`. Set **Health Check Path** to `/healthz` and enable Auto-Deploy
under the web service's settings.

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

- `web/app.js`: home page, `/tests` route, account UI, and browser-local settings.
- `backend/auth.py`: PostgreSQL startup, account endpoints, and session handling.
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

The Preferences section saves general exercise preferences immediately to the local profile: Pause After Correct Answers, Pause After Incorrect Answers, and Show Pitch Graph During Review. Guests can change these for the current visit. Pitch graphs show expected H/L contours during review; answer reviews always show audio controls. A separate Test settings section is intentionally blank for future exercise-specific options.

The separate History page includes overall accuracy, completed/other status filtering, ten sessions per page, duration, category statistics, and expandable per-question review with the chosen answer, correct answer, audio, pitch graph, and response time. Accuracy plots show the latest 30 sessions with answers; activity plots show question totals for the latest 14 practice days. Both follow the status filter and include expandable text data. Empty histories show no invented results. Older summary-only records still work and explicitly indicate that answer details are unavailable. Tracked answers and a snapshot of session preferences are stored with each session.

Edit `web/tests/SyllablePitch.js` to implement exercise behavior. `web/index.html` loads it and `Tests.js` before `app.js`. The Tests route creates a catalog/setup controller, which creates the exercise when Start session is selected. Route changes destroy the instance and cancel its automatic-next-question timer. Add future exercises to the registry at the top of `Tests.js`; category groups and links are generated from it.

`load()` starts a shuffled queue with `POST /api/tests/syllable-pitch/session` (category settings plus `question_count`, or `null` for a full pass) and validates `syllables_no_pitch: string[]`, `tone_profile: string[]`, `options_profile: string[][]`, `word: string`, and `audio_id: string`. The array lengths must agree and each correct contour must be an offered option. Each syllable has a separate radio group; Check answer requires all groups to be answered. Review marks each syllable individually. A question counts as correct only when every syllable is correct, and session limits count whole questions. The accented word is revealed after submission.

The backend reads `backend/metadata.csv` and generates `options_profile` for each syllable. Rows with missing audio or incompatible syllable/contour metadata are excluded without editing the CSV. Audio IDs are unique filename stems, resolved through a server-side allowlist; filesystem paths are never returned. `GET /api/audio/{audio_id}` serves OGG recordings with range support. Unknown IDs return 404.

The browser decodes the OGG using Web Audio and estimates fundamental frequency (F0, 60?600 Hz) using a YIN-style periodicity detector with recording-relative silence detection and a speech-tolerant confidence threshold. Very short pitch-consistent dropouts can be bridged; long gaps remain unvoiced. The Hz-versus-time curve is shown only after submitting an answer and when Show Pitch Graph During Review is enabled. Silence and uncertain frames remain gaps. This estimate can contain tracking or octave errors; it does not replace the annotated H/L contours. Frequency data and per-syllable results are saved with tracked answers for later review. If decoding or pitch detection is unavailable, review displays an unavailable message and native playback is still offered. Browsers must support the recording's OGG codec for playback. Dummy tone endpoints remain available separately.

Review frequency graphs include a playhead and shaded progress synchronized to the associated recording, graph click-to-seek, a keyboard-accessible seek slider, and a playback time readout. These work with inline players and Play recording buttons, including saved history. Playback synchronization uses the media current time and animation frames; leaving or changing the review stops playback and removes listeners. The archived Japanese minimal-pairs component contains static accent notation and native audio, rather than this synchronized frequency player.

Each CSV row is a distinct example, identified by its source row index (`example_id`, stable while CSV row order is unchanged). Limited tests sample rows without replacement and cap at the available count. Unlimited practice exhausts every eligible row before requesting a new shuffled pass. Answer history retains example IDs. Unfinished sessions are marked interrupted when leaving; reloading does not resume the exercise queue. The random endpoint remains available for individual exercises.

New syllable exercises extend `Exercise` in `web/tests/Exercise.js`. The base owns the shuffled session queue, validation, per-syllable choices, whole-word scoring, review audio, and cleanup. Subclasses declare their endpoint, syllable/profile fields, choice validation/labels, instructions, and review graph hook. Override `sessionSettings()` for request filters and `decodeRecording()` for optional analysis. Load the base before subclasses in `web/index.html`; register each subclass and its review renderer in `web/tests/Tests.js`. `SyllableNasality` is a minimal Oral/Nasal example; `SyllablePitch` also supplies contour graphs and pitch analysis.

Vowel Length is available at `#/tests/vowel-length`, backed by `POST /api/tests/vowel-length/session`. Enable at least two vowel forms: short vowel (`a`), long vowel (`aa`), diphthong (`ai`), and long diphthong (`aii`). Choices use the same first vowel, surrounding consonants, nasality, and tone contour. Diphthongs are based on nuclei found in the dataset. Prompts keep the first marked vowel followed by `*`. Syllables are skipped when the recorded form is disabled, fewer than two spellings are available, or a tone transition makes the enabled short form impossible. Each source row remains one example, sampled without replacement.

`VowelLength` extends `Exercise` in `web/tests/VowelLength.js`. Run `npm.cmd test` for frontend and live API coverage, and `.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` for vowel/tone boundary cases.
