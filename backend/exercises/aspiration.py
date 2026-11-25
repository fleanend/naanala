"""Aspiration exercise rules and generation."""

from pathlib import Path

import pandas as pd

from ..schemas import AspirationExercise, AspirationSyllableSettings
from .vowel_length import vowel_parts

ALVEOLAR_STOPS = ["d", "t", "tʼ"]
VELAR_STOPS = ["g", "k", "kʼ"]
ALVEOLAR_AFFRICATES = ["dz", "ts", "tsʼ"]
POSTALVEOLAR_AFFRICATES = ["j", "ch", "chʼ"]
ALVEOLAR_LATERAL_AFFRICATES = ["dl", "tł", "tłʼ"]
UNASPIRATED = ["d", "g", "dz", "j", "dl"]
ASPIRATED = ["t", "k", "ts", "ch", "tł"]
EJECTIVES = ["tʼ", "kʼ", "tsʼ", "chʼ", "tłʼ"]

OPTIONS = {}

for u, a, e in zip(UNASPIRATED, ASPIRATED, EJECTIVES):
    OPTIONS[u] = [u, a, e]
    OPTIONS[a] = [u, a, e]
    OPTIONS[e] = [u, a, e]

HIDE = {}

for c in ALVEOLAR_STOPS:
    HIDE[c] = "D"

for c in VELAR_STOPS:
    HIDE[c] = "G"

for c in ALVEOLAR_AFFRICATES:
    HIDE[c] = "DZ"

for c in POSTALVEOLAR_AFFRICATES:
    HIDE[c] = "J"

for c in ALVEOLAR_LATERAL_AFFRICATES:
    HIDE[c] = "DL"



onset = lambda syll: vowel_parts(syll)[0]
notonset = lambda syll: "".join(vowel_parts(syll)[1]) + vowel_parts(syll)[2]

def onset_enabled(onset: str, settings: AspirationSyllableSettings) -> bool:
    """
        Check if the onset is enabled based on the provided settings.
        
        Args:
            onset (str): The onset of the syllable to check.
            settings (AspirationSyllableSettings): The settings to check against.
            
        Returns:
            bool: True if the onset is enabled, False otherwise.
    """
    return onset in OPTIONS and not (
        (not settings.alveolar_stop and onset in ALVEOLAR_STOPS)
        or (not settings.alveolar_affricate and onset in ALVEOLAR_AFFRICATES)
        or (not settings.alveolar_lateral_affricate and onset in ALVEOLAR_LATERAL_AFFRICATES)
        or (not settings.postalveolar_affricate and onset in POSTALVEOLAR_AFFRICATES)
        or (not settings.velar_stop and onset in VELAR_STOPS)
        or (not settings.unaspirated and onset in UNASPIRATED)
        or (not settings.aspirated and onset in ASPIRATED)
        or (not settings.ejective and onset in EJECTIVES)
    )


def eligible_aspiration_examples(data: pd.DataFrame, settings: AspirationSyllableSettings) -> pd.DataFrame:
    """
        Filter the DataFrame to include only eligible aspiration examples based on the provided settings.
        
        Aspiration requirements need only one valid syllable, so we filter out examples that don't meet this requirement.

        Args:
            data (pd.DataFrame): The DataFrame containing aspiration examples.
            settings (AspirationSyllableSettings): The settings to filter against.
        
        Returns:
            pd.DataFrame: A filtered DataFrame containing only eligible aspiration examples.
    """
    data = data[data.apply(lambda row: (
        bool(row["syllables"])
        and all(isinstance(syll, str) and syll for syll in row["syllables"])
    ), axis=1)]
    selected = data[data["syllables"].apply(lambda syllables: any(onset_enabled(onset(syll), settings) for syll in syllables))]
    return selected


def make_aspiration_exercise(row: pd.Series, settings: AspirationSyllableSettings) -> AspirationExercise:
    """
        Create a AspirationExercise from a dataset row.

        Args:
            row (pd.Series): A row from the dataset containing word and syllables.
            settings (PitchSyllableSettings): The settings for pitch exercises.

        Returns:
            PitchSyllableExercise: A PitchSyllableExercise object.
    """
    syllables = row["syllables"]
    profile = [syll if onset_enabled(onset(syll), settings) else "P" for syll in syllables]
    options = [
        [option + notonset(syll) for option in OPTIONS[onset(syll)] if onset_enabled(option, settings)]
        if enabled != "P" else []
        for syll, enabled in zip(syllables, profile)
    ]
    prompt = [
        HIDE[onset(syll)] + notonset(syll)
        if enabled != "P" else syll
        for syll, enabled in zip(syllables, profile)
    ]

    return AspirationExercise(
        example_id=str(row.name),
        syllables_aspiration_prompt=prompt,
        aspiration_profile=profile,
        original_aspiration_profile=syllables,
        options_profile=options,
        word=row["word"],
        audio_id=Path(row["local_path"].replace("\\", "/")).stem,
    )

