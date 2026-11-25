"""FastAPI wiring, HTTP routes, and frontend hosting."""

import random
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .dataset import load_dataset
from .exercises.aspiration import eligible_aspiration_examples, make_aspiration_exercise
from .exercises.nasality import eligible_nasality_examples, make_nasality_exercise
from .exercises.pitch import eligible_pitch_examples, make_pitch_exercise
from .exercises.vowel_length import make_length_exercise
from .schemas import (
    AspirationExercise,
    AspirationSyllableSettings,
    NasalSyllableExercise,
    NasalSyllableSettings,
    PitchSyllableExercise,
    PitchSyllableSettings,
    SyllableSession,
    VowelLengthExercise,
    VowelLengthSettings,
)

WEB = Path(__file__).resolve().parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.dataset = load_dataset()
    yield

app = FastAPI(title="Naanala API", lifespan=lifespan)


@app.middleware("http")
async def refresh_frontend_assets(request, call_next):
    response = await call_next(request)
    # Local development assets must not keep an old API contract in the browser.
    if request.url.path == "/" or request.url.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/tests/syllable-pitch/session", response_model=SyllableSession[PitchSyllableExercise])
def syllable_pitch_session(settings: PitchSyllableSettings, request: Request) -> SyllableSession[PitchSyllableExercise]:
    selected = eligible_pitch_examples(request.app.state.dataset.data, settings)
    if selected.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    count = min(settings.question_count, len(selected)) if settings.question_count is not None else len(selected)
    return SyllableSession[PitchSyllableExercise](
        exercises=[make_pitch_exercise(row, settings) for _, row in selected.sample(n=count).iterrows()],
        available_count=len(selected),
    )

@app.post("/api/tests/syllable-nasal/session", response_model=SyllableSession[NasalSyllableExercise])
def syllable_nasal_session(settings: NasalSyllableSettings, request: Request) -> SyllableSession[NasalSyllableExercise]:
    selected = eligible_nasality_examples(request.app.state.dataset.data, settings)
    if selected.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    count = min(settings.question_count, len(selected)) if settings.question_count is not None else len(selected)
    return SyllableSession[NasalSyllableExercise](
        exercises=[make_nasality_exercise(row, settings) for _, row in selected.sample(n=count).iterrows()],
        available_count=len(selected),
    )

@app.post("/api/tests/vowel-length/session", response_model=SyllableSession[VowelLengthExercise])
def vowel_length_session(settings: VowelLengthSettings, request: Request) -> SyllableSession[VowelLengthExercise]:
    exercises = [exercise for _, row in request.app.state.dataset.data.iterrows() if (exercise := make_length_exercise(row, settings, request.app.state.dataset.diphthongs)) is not None]
    if not exercises:
        raise HTTPException(status_code=503, detail="No recordings available for these vowel forms")
    available = len(exercises)
    random.shuffle(exercises)
    count = min(settings.question_count, available) if settings.question_count is not None else available
    return SyllableSession[VowelLengthExercise](exercises=exercises[:count], available_count=available)

@app.post("/api/tests/aspiration/session", response_model=SyllableSession[AspirationExercise])
def aspiration_session(settings: AspirationSyllableSettings, request: Request) -> SyllableSession[AspirationExercise]:
    selected = eligible_aspiration_examples(request.app.state.dataset.data, settings)
    if selected.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    count = min(settings.question_count, len(selected)) if settings.question_count is not None else len(selected)
    return SyllableSession[AspirationExercise](
        exercises=[make_aspiration_exercise(row, settings) for _, row in selected.sample(n=count).iterrows()],
        available_count=len(selected),
    )

@app.get("/api/audio/{audio_id}")
def recording(audio_id: str, request: Request) -> FileResponse:
    # Look up an opaque ID, never turn user input into a filesystem path.
    path = request.app.state.dataset.audio_files.get(audio_id)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(path, media_type="audio/ogg", headers={"Cache-Control": "public, max-age=3600"})


# Mount only the public frontend, after API routes. Legacy code and project files stay private.
app.mount("/", StaticFiles(directory=WEB, html=True), name="frontend")
