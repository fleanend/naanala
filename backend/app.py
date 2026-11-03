"""FastAPI frontend host, syllable-pitch exercises, and recording lookup."""

import ast
import random
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Generic, TypeVar

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


class SyllableExercise(BaseModel):
    example_id: str
    options_profile: list[list[str]]
    word: str
    audio_id: str

class PitchSyllableExercise(SyllableExercise):
    syllables_no_pitch: list[str]
    tone_profile: list[str]
    original_tone_profile: list[str] = []

class NasalSyllableExercise(SyllableExercise):
    syllables_no_nasals: list[str]
    nasal_profile: list[str]
    original_nasal_profile: list[str] = []


class VowelLengthExercise(SyllableExercise):
    syllables_length_prompt: list[str]
    length_profile: list[str]
    original_length_profile: list[str]
    contrast_profile: list[str]


class SyllableSessionSettings(BaseModel):
    question_count: int | None = Field(default=None, ge=1, le=1000)

class VowelLengthSettings(SyllableSessionSettings):
    short_long: bool = True
    short_diphthong: bool = True
    long_diphthong: bool = True
    diphthong_long_final: bool = True


class PitchSyllableSettings(SyllableSessionSettings):
    monophthongs: bool = True
    diphthongs_long_vowels: bool = True
    triphthongs_diphthongs_with_long_vowels: bool = True
    flat: bool = True
    rising: bool = True
    descending: bool = True

class NasalSyllableSettings(SyllableSessionSettings):
    allow_nasal_syllables: bool = True



ExerciseType = TypeVar("ExerciseType", bound=SyllableExercise)


class SyllableSession(BaseModel, Generic[ExerciseType]):
    exercises: list[ExerciseType]
    available_count: int


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
    converters={"syllables_no_tone": ast.literal_eval, "tone_profile": ast.literal_eval,
                "syllables_no_nasals": ast.literal_eval, "nasal_profile": ast.literal_eval, "n_in_syllables": ast.literal_eval},
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


def tone_enabled(tone: str, settings: PitchSyllableSettings) -> bool:
    return not (
        (not settings.flat and tone in flat_tones)
        or (not settings.rising and tone in rising_tones)
        or (not settings.descending and tone in descending_tones)
        or (not settings.monophthongs and len(tone) == 1)
        or (not settings.diphthongs_long_vowels and len(tone) == 2)
        or (not settings.triphthongs_diphthongs_with_long_vowels and len(tone) == 3)
    )


def eligible_pitch_examples(settings: PitchSyllableSettings) -> pd.DataFrame:
    selected = data[data["tone_profile"].apply(lambda tones: any(tone_enabled(tone, settings) for tone in tones))]
    if selected.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    return selected


def eligible_nasality_examples(settings: NasalSyllableSettings) -> pd.DataFrame:
    selected = data[(data["nasal_profile"].apply(lambda y: any(x == 'N' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = data[(data["nasal_profile"].apply(lambda y: all(x == 'O' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = selected_neg.sample(n=selected.shape[0] // 2, random_state=42)
    if selected.empty:
        raise HTTPException(status_code=503, detail="No recordings available for these settings")
    return pd.concat([selected, selected_neg])


def make_pitch_exercise(row: pd.Series, settings: PitchSyllableSettings) -> PitchSyllableExercise:
    tones = row["tone_profile"]
    profile = [tone if tone_enabled(tone, settings) else "P" for tone in tones]
    options = [
        [option for option in dict.fromkeys([*tone_options[len(tone)], tone]) if tone_enabled(option, settings)]
        if enabled != "P" else []
        for tone, enabled in zip(tones, profile)
    ]
    return PitchSyllableExercise(
        example_id=str(row.name),
        syllables_no_pitch=row["syllables_no_tone"],
        tone_profile=profile,
        original_tone_profile=tones,
        options_profile=options,
        word=row["word"],
        audio_id=Path(row["local_path"].replace("\\", "/")).stem,
    )

def make_nasality_exercise(row: pd.Series, settings: NasalSyllableSettings) -> NasalSyllableExercise:
    profile = row["nasal_profile"]
    options = [["O", "N"] for _ in profile]
    return NasalSyllableExercise(
        example_id=str(row.name),
        syllables_no_nasals=row["syllables_no_nasals"],
        nasal_profile=profile,
        original_nasal_profile=profile,
        options_profile=options,
        word=row["word"],
        audio_id=Path(row["local_path"].replace("\\", "/")).stem,
    )

@app.post("/api/tests/syllable-pitch/session", response_model=SyllableSession[PitchSyllableExercise])
def syllable_pitch_session(settings: PitchSyllableSettings) -> SyllableSession[PitchSyllableExercise]:
    selected = eligible_pitch_examples(settings)
    count = min(settings.question_count, len(selected)) if settings.question_count is not None else len(selected)
    return SyllableSession[PitchSyllableExercise](
        exercises=[make_pitch_exercise(row, settings) for _, row in selected.sample(n=count).iterrows()],
        available_count=len(selected),
    )

@app.post("/api/tests/syllable-nasal/session", response_model=SyllableSession[NasalSyllableExercise])
def syllable_nasal_session(settings: NasalSyllableSettings) -> SyllableSession[NasalSyllableExercise]:
    selected = eligible_nasality_examples(settings)
    count = min(settings.question_count, len(selected)) if settings.question_count is not None else len(selected)
    return SyllableSession[NasalSyllableExercise](
        exercises=[make_nasality_exercise(row, settings) for _, row in selected.sample(n=count).iterrows()],
        available_count=len(selected),
    )

# Derive vowel choices from the spellings in this dataset, without guessing new diphthongs.
def vowel_parts(syllable: str):
    clusters = []
    for char in unicodedata.normalize("NFD", syllable):
        if unicodedata.combining(char) and clusters:
            clusters[-1] += char
        else:
            clusters.append(char)
    positions = [i for i, cluster in enumerate(clusters) if cluster[0].lower() in "aeiou"]
    if not positions or positions != list(range(positions[0], positions[-1] + 1)):
        return None
    start, end = positions[0], positions[-1] + 1
    return "".join(clusters[:start]), clusters[start:end], "".join(clusters[end:])


@lru_cache(maxsize=1)
def vowel_diphthongs() -> tuple[str, ...]:
    found = set()
    for syllables in data["syllables"]:
        for syllable in ast.literal_eval(syllables) if isinstance(syllables, str) else syllables:
            parts = vowel_parts(syllable)
            if parts:
                nucleus = "".join(cluster[0].lower() for cluster in parts[1])
                if len(nucleus) == 2 and nucleus[0] != nucleus[1]:
                    found.add(nucleus)
    return tuple(sorted(found))


def marked_nucleus(nucleus: str, tones: str, nasal: bool) -> str:
    return unicodedata.normalize("NFC", "".join(
        vowel + ("\u0328" if nasal else "") + ("\u0301" if tone == "H" else "")
        for vowel, tone in zip(nucleus, tones)
    ))


def length_pairs(syllable: str, tone: str, nasal: str, settings: VowelLengthSettings):
    """Return eligible binary contrasts with identical tone and nasality on both options."""
    parts = vowel_parts(syllable)
    if not parts:
        return []
    prefix, clusters, suffix = parts
    nucleus = "".join(cluster[0].lower() for cluster in clusters)
    if len(nucleus) != len(tone) or nasal not in ("O", "N"):
        return []
    # Do not invent a uniform nasality or tone when the source marks disagree.
    if any(("\u0328" in cluster) != (nasal == "N") for cluster in clusters):
        return []
    if any(("\u0301" in cluster) != (level == "H") for cluster, level in zip(clusters, tone)):
        return []
    alternatives = []
    def add(kind, other, other_tone):
        if getattr(settings, kind):
            alternatives.append((kind, unicodedata.normalize("NFC", prefix + marked_nucleus(other, other_tone, nasal == "N") + suffix)))
    flat = len(set(tone)) == 1
    dips = vowel_diphthongs()
    if len(nucleus) == 1:
        add("short_long", nucleus * 2, tone * 2)
        for dip in dips:
            if dip[0] == nucleus:
                add("short_diphthong", dip, tone * 2)
    elif len(nucleus) == 2 and nucleus[0] == nucleus[1]:
        if flat:
            add("short_long", nucleus[0], tone[0])
        for dip in dips:
            if dip[0] == nucleus[0]:
                add("long_diphthong", dip, tone)
    elif nucleus in dips:
        if flat:
            add("short_diphthong", nucleus[0], tone[0])
        add("long_diphthong", nucleus[0] * 2, tone)
        add("diphthong_long_final", nucleus + nucleus[-1], tone + tone[-1])
    elif len(nucleus) == 3 and nucleus[0] != nucleus[1] and nucleus[1] == nucleus[2] and nucleus[:2] in dips:
        # Shortening the final vowel must not remove a tone transition.
        if tone[1] == tone[2]:
            add("diphthong_long_final", nucleus[:2], tone[:2])
    return alternatives


def make_length_exercise(row: pd.Series, settings: VowelLengthSettings) -> VowelLengthExercise | None:
    syllables = ast.literal_eval(row["syllables"]) if isinstance(row["syllables"], str) else row["syllables"]
    tones, nasals = row["tone_profile"], row["nasal_profile"]
    if not (len(syllables) == len(tones) == len(nasals)):
        return None
    prompts, answers, originals, options, contrasts = [], [], [], [], []
    for syllable, tone, nasal in zip(syllables, tones, nasals):
        actual = unicodedata.normalize("NFC", syllable)
        pairs = length_pairs(syllable, tone, nasal, settings)
        originals.append(actual)
        if not pairs:
            prompts.append(actual + " (not tested)")
            answers.append("P")
            options.append([])
            contrasts.append("")
            continue
        kind, alternate = random.choice(pairs)
        pair = [actual, alternate]
        random.shuffle(pair)
        parts = vowel_parts(syllable)
        # Keep the known first vowel (including its marks), hiding the remaining vowel form.
        prompts.append(unicodedata.normalize("NFC", parts[0] + parts[1][0] + "*" + parts[2]))
        answers.append(actual)
        options.append(pair)
        contrasts.append(kind)
    if all(answer == "P" for answer in answers):
        return None
    return VowelLengthExercise(
        example_id=str(row.name), syllables_length_prompt=prompts, length_profile=answers,
        original_length_profile=originals, options_profile=options, contrast_profile=contrasts,
        word=row["word"], audio_id=Path(row["local_path"].replace("\\", "/")).stem,
    )


@app.post("/api/tests/vowel-length/session", response_model=SyllableSession[VowelLengthExercise])
def vowel_length_session(settings: VowelLengthSettings) -> SyllableSession[VowelLengthExercise]:
    # One row stays one example even when several syllables or contrasts are eligible.
    exercises = [exercise for _, row in data.iterrows() if (exercise := make_length_exercise(row, settings)) is not None]
    if not exercises:
        raise HTTPException(status_code=503, detail="No recordings available for these contrasts")
    available = len(exercises)
    random.shuffle(exercises)
    count = min(settings.question_count, available) if settings.question_count is not None else available
    return SyllableSession[VowelLengthExercise](exercises=exercises[:count], available_count=available)


@app.get("/api/audio/{audio_id}")
def recording(audio_id: str) -> FileResponse:
    # Look up an opaque ID, never turn user input into a filesystem path.
    path = audio_files.get(audio_id)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(path, media_type="audio/ogg", headers={"Cache-Control": "public, max-age=3600"})


# Mount only the public frontend, after API routes. Legacy code and project files stay private.
app.mount("/", StaticFiles(directory=WEB, html=True), name="frontend")
