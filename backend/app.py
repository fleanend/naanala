"""FastAPI frontend host, syllable-pitch exercises, and recording lookup."""

import ast
import math
import random
import struct
import wave
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


class PitchSyllableExercise(BaseModel):
    syllables_no_pitch: list[str]
    tone_profile: list[str]
    options_profile: list[list[str]]
    word: str
    audio_id: str
    original_tone_profile: list[str] = []


class PitchSyllableSettings(BaseModel):
    monophthongs: bool = True
    diphthongs_long_vowels: bool = True
    triphthongs_diphthongs_with_long_vowels: bool = True
    flat: bool = True
    rising: bool = True
    descending: bool = True


app = FastAPI(title="Naanala API")


@app.middleware("http")
async def refresh_frontend_assets(request, call_next):
    response = await call_next(request)
    # Local development assets must not keep an old API contract in the browser.
    if request.url.path == "/" or request.url.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store"
    return response


WEB = Path(__file__).resolve().parent.parent / "web"
data = pd.read_csv(
    Path(__file__).resolve().parent / "metadata.csv",
    converters={"syllables_no_tone": ast.literal_eval, "tone_profile": ast.literal_eval},
)
AUDIO_ROOT = Path(__file__).resolve().parent / "navajo_wiktionary" / "audio"
audio_files: dict[str, Path] = {}
for local_path in data["local_path"]:
    recording = (Path(__file__).resolve().parent / str(local_path).replace("\\", "/")).resolve() # type: ignore
    if recording.is_relative_to(AUDIO_ROOT.resolve()) and recording.suffix.lower() == ".ogg" and recording.is_file(): # type: ignore
        if recording.stem in audio_files and audio_files[recording.stem] != recording: # type: ignore
            raise ValueError("Recording IDs must be unique")
        audio_files[recording.stem] = recording # type: ignore
data = data[data["local_path"].map(lambda value: Path(str(value).replace("\\", "/")).stem in audio_files)]
tone_options = {
    1 : ["H", "L"],
    2 : ["HH", "LL", "LH", "HL"],
    3 : ["HHH", "LLL", "LLH", "LHH", "HLL", "HHL"]
}

flat_tones = [
            "H", "L",
            "HH", "LL",
            "HHH", "LLL"
            ]

rising_tones = ["LH", "LLH", "LHH"]

descending_tones = ["HL", "HHL", "HLL"]

# Some source rows have different syllable and contour counts. They cannot be
# graded syllable by syllable; leave the source CSV intact and skip them here.
print(data[data.apply(lambda row: not (
    bool(row["tone_profile"])
    and len(row["syllables_no_tone"]) == len(row["tone_profile"])
    and all(isinstance(label, str) and label for label in row["syllables_no_tone"])
    and all(isinstance(tone, str) and len(tone) in tone_options and not set(tone) - set("HL") for tone in row["tone_profile"])
), axis=1)])
data = data[data.apply(lambda row: (
    bool(row["tone_profile"])
    and len(row["syllables_no_tone"]) == len(row["tone_profile"])
    and all(isinstance(label, str) and label for label in row["syllables_no_tone"])
    and all(isinstance(tone, str) and len(tone) in tone_options and not set(tone) - set("HL") for tone in row["tone_profile"])
), axis=1)]


@app.get("/api/tests/syllable-pitch/random", response_model=PitchSyllableExercise)
def syllable_pitch(
        monophthongs: bool = True,
        diphthongs_long_vowels: bool = True,
        triphthongs_diphthongs_with_long_vowels: bool = True,
        flat: bool = True,
        rising: bool = True,
        descending: bool = True
    ) -> PitchSyllableExercise:

    selected_df = data
    def enabled(tone: str) -> bool:
        return not (
            (not flat and tone in flat_tones)
            or (not rising and tone in rising_tones)
            or (not descending and tone in descending_tones)
            or (not monophthongs and len(tone) == 1)
            or (not diphthongs_long_vowels and len(tone) == 2)
            or (not triphthongs_diphthongs_with_long_vowels and len(tone) == 3)
        )
    # A word must retain at least one syllable after all filters are combined.
    selected_df = selected_df[selected_df["tone_profile"].apply(lambda tones: any(enabled(tone) for tone in tones))]
    if selected_df.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    #  filter out lines which have only the disabled feature
    if not flat:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(y in flat_tones for y in x))]
    if not rising:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(y in rising_tones for y in x))]
    if not descending:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(y in descending_tones for y in x))]
    if not monophthongs:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(len(y) == 1 for y in x))]
    if not diphthongs_long_vowels:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(len(y) == 2 for y in x))]
    if not triphthongs_diphthongs_with_long_vowels:
        selected_df = selected_df[selected_df["tone_profile"].apply(lambda x: not all(len(y) == 3 for y in x))]
    if selected_df.empty:
        raise HTTPException(status_code=503, detail="No recordings available")
    i = random.randint(0, len(selected_df) - 1)

    #  mark disabled lines as "P", the front end will disregard it for the results
    tone_profile = selected_df.iloc[i]["tone_profile"]
    new_tone_profile = []
    for tone in tone_profile:
        if (not flat and tone in flat_tones) or (
            not rising and tone in rising_tones) or (
            not descending and tone in descending_tones) or (
            not monophthongs and len(tone) == 1) or (
            not diphthongs_long_vowels and len(tone) == 2) or (
            not triphthongs_diphthongs_with_long_vowels and len(tone) == 3
            ):
                new_tone_profile.append("P")
        else:
            new_tone_profile.append(tone)

    #  hide disabled options
    options_profile = [list(dict.fromkeys([*tone_options[len(syllable)], syllable])) for syllable in tone_profile]
    new_options_profile = []
    for option in options_profile:
        new_option = []
        for tone in option:
            if (not flat and tone in flat_tones) or (
                not rising and tone in rising_tones) or (
                not descending and tone in descending_tones) or (
                not monophthongs and len(tone) == 1) or (
                not diphthongs_long_vowels and len(tone) == 2) or (
                not triphthongs_diphthongs_with_long_vowels and len(tone) == 3
                ):
                continue
            else:
                new_option.append(tone)
        new_options_profile.append(new_option)

    # Keep all three arrays aligned, including skipped syllables.
    new_options_profile = [options if tone != "P" else [] for tone, options in zip(new_tone_profile, new_options_profile)]

    return PitchSyllableExercise(
        syllables_no_pitch = selected_df.iloc[i]["syllables_no_tone"],
        tone_profile = new_tone_profile,
        original_tone_profile = tone_profile,
        options_profile = new_options_profile,
        word = selected_df.iloc[i]["word"],
        audio_id = Path(selected_df.iloc[i]["local_path"].replace("\\", "/")).stem
    )


@app.post("/api/tests/syllable-pitch/random", response_model=PitchSyllableExercise)
def syllable_pitch_with_settings(settings: PitchSyllableSettings) -> PitchSyllableExercise:
    return syllable_pitch(**settings.model_dump())


@app.get("/api/audio/{audio_id}")
def recording(audio_id: str) -> FileResponse:
    # Look up an opaque ID, never turn user input into a filesystem path.
    path = audio_files.get(audio_id)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(path, media_type="audio/ogg", headers={"Cache-Control": "public, max-age=3600"})


# Mount only the public frontend, after API routes. Legacy code and project files stay private.
app.mount("/", StaticFiles(directory=WEB, html=True), name="frontend")
