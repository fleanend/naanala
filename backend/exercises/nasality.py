"""Nasality exercise selection and generation."""

from pathlib import Path

import pandas as pd

from ..schemas import NasalSyllableExercise, NasalSyllableSettings


def eligible_nasality_examples(data: pd.DataFrame, settings: NasalSyllableSettings) -> pd.DataFrame:
    selected = data[(data["nasal_profile"].apply(lambda y: any(x == 'N' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = data[(data["nasal_profile"].apply(lambda y: all(x == 'O' for x in y)))&(~data["n_in_syllables"])]
    selected_neg = selected_neg.sample(n=selected.shape[0] // 2, random_state=42)
    return pd.concat([selected, selected_neg])


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

