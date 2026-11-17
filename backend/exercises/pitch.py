"""Pitch exercise rules and generation."""

from pathlib import Path

import pandas as pd

from ..schemas import PitchSyllableExercise, PitchSyllableSettings

TONE_OPTIONS = {
    1 : ["H", "L"],
    2 : ["HH", "LL", "LH", "HL"],
    3 : ["HHH", "LLL", "LLH", "LHH", "HLL", "HHL"]
}

FLAT_TONES = [
            "H", "L",
            "HH", "LL",
            "HHH", "LLL"
            ]

RISING_TONES = ["LH", "LLH", "LHH"]

DESCENDING_TONES = ["HL", "HHL", "HLL"]

def tone_enabled(tone: str, settings: PitchSyllableSettings) -> bool:
    """
        Check if a tone is enabled based on the provided settings.
        
        Args:
            tone (str): The tone to check.
            settings (PitchSyllableSettings): The settings to check against.
            
        Returns:
            bool: True if the tone is enabled, False otherwise.
    """
    return not (
        (not settings.flat and tone in FLAT_TONES)
        or (not settings.rising and tone in RISING_TONES)
        or (not settings.descending and tone in DESCENDING_TONES)
        or (not settings.monophthongs and len(tone) == 1)
        or (not settings.diphthongs_long_vowels and len(tone) == 2)
        or (not settings.triphthongs_diphthongs_with_long_vowels and len(tone) == 3)
    )


def eligible_pitch_examples(data: pd.DataFrame, settings: PitchSyllableSettings) -> pd.DataFrame:
    """
        Filter the DataFrame to include only eligible pitch examples based on the provided settings.
        
        Pitch requirements need only one valid contour per displayed syllable, so we filter out examples that don't meet this requirement.

        Args:
            data (pd.DataFrame): The DataFrame containing pitch examples.
            settings (PitchSyllableSettings): The settings to filter against.
        
        Returns:
            pd.DataFrame: A filtered DataFrame containing only eligible pitch examples.
    """
    data = data[data.apply(lambda row: (
        bool(row["tone_profile"])
        and len(row["syllables_no_tone"]) == len(row["tone_profile"])
        and all(isinstance(label, str) and label for label in row["syllables_no_tone"])
        and all(
            isinstance(tone, str) and len(tone) in TONE_OPTIONS and not set(tone) - set("HL")
            for tone in row["tone_profile"]
        )
    ), axis=1)]
    selected = data[data["tone_profile"].apply(lambda tones: any(tone_enabled(tone, settings) for tone in tones))]
    return selected


def make_pitch_exercise(row: pd.Series, settings: PitchSyllableSettings) -> PitchSyllableExercise:
    """
        Create a VowelLengthExercise from a dataset row.

        Args:
            row (pd.Series): A row from the dataset containing word, tones and syllables with no tones.
            settings (PitchSyllableSettings): The settings for pitch exercises.

        Returns:
            PitchSyllableExercise: A PitchSyllableExercise object.
    """
    tones = row["tone_profile"]
    profile = [tone if tone_enabled(tone, settings) else "P" for tone in tones]
    options = [
        [option for option in dict.fromkeys([*TONE_OPTIONS[len(tone)], tone]) if tone_enabled(option, settings)]
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

