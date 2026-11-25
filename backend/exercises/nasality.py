"""Nasality exercise selection and generation."""

from pathlib import Path

import pandas as pd

from ..schemas import NasalSyllableExercise, NasalSyllableSettings


def eligible_nasality_examples(data: pd.DataFrame, settings: NasalSyllableSettings) -> pd.DataFrame:
    """
        Check if words are eligible for nasality test.

        Words with n in any syllable are discarded as nasality is present or absent depending on the speaker in such cases.
        Since words with at least a nasal syllable are much rare than words without, create a negative dataset to add more cases to the test

        Args:
            data (pd.DataFrame): A dataset containing nasal_profile and n_in_syllables.
            settings (NasalSyllableSettings): The settings for pitch exercises.

        Returns:
            PitchSyllableExercise: A PitchSyllableExercise object.
    """
    selected = data[(data["nasal_profile"].apply(lambda y: any(x == 'N' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = data[(data["nasal_profile"].apply(lambda y: all(x == 'O' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = selected_neg.sample(n=selected.shape[0] // 2, random_state=1284)
    return pd.concat([selected, selected_neg])


def make_nasality_exercise(row: pd.Series, settings: NasalSyllableSettings) -> NasalSyllableExercise:
    """
        Create a NasalSyllableExercise from a dataset row.

        Args:
            row (pd.Series): A row from the dataset containing word, nasal_profile and syllables with no nasals.
            settings (NasalSyllableSettings): The settings for pitch exercises.

        Returns:
            PitchSyllableExercise: A PitchSyllableExercise object.
    """
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

