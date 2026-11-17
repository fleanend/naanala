"""API request and response schemas."""

from typing import Generic, TypeVar

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


