"""Load metadata and index verified local recordings at application startup."""

import ast
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .exercises.vowel_length import vowel_diphthongs

BACKEND_ROOT = Path(__file__).resolve().parent
AUDIO_ROOT = BACKEND_ROOT / "navajo_wiktionary" / "audio"


@dataclass
class Dataset:
    data: pd.DataFrame
    audio_files: dict[str, Path]
    diphthongs: tuple[str, ...]


def load_dataset() -> Dataset:
    data = pd.read_csv(
        BACKEND_ROOT / "metadata.csv",
        converters={column: ast.literal_eval for column in (
            "syllables_no_tone", "tone_profile", "syllables_no_nasals",
            "nasal_profile", "n_in_syllables", "syllables"
        )},
    )
    audio_files: dict[str, Path] = {}
    for local_path in data["local_path"]:
        recording = (BACKEND_ROOT / str(local_path).replace(chr(92), "/")).resolve()
        if recording.is_relative_to(AUDIO_ROOT.resolve()) and recording.suffix.lower() == ".ogg" and recording.is_file():
            audio_files[recording.stem] = recording
    data = data[data["local_path"].map(
        lambda value: Path(str(value).replace(chr(92), "/")).stem in audio_files
    )]
    return Dataset(data=data, audio_files=audio_files, diphthongs=vowel_diphthongs(data))
