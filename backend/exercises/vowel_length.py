"""Vowel-length parsing, options, and exercise generation."""

import ast
import random
import unicodedata
from pathlib import Path

import pandas as pd

from ..schemas import VowelLengthExercise, VowelLengthSettings

# Derive vowel choices from the spellings in this dataset, without guessing new diphthongs.
def vowel_parts(syllable: str) -> tuple[str, list[str], str]:
    """
        Return the onset, vowel nucleus, and coda of a syllable.
        
        Args:
            syllable (str): The syllable to parse.

        Returns:
            tuple[str, list[str], str]: A tuple containing the onset (str), a list of vowel clusters (list[str]), and the coda (str).

        Raises:
            ValueError: If the syllable does not contain a single contiguous vowel nucleus.
    """
    clusters = []
    for char in unicodedata.normalize("NFD", syllable):
        if unicodedata.combining(char) and clusters:
            clusters[-1] += char
        else:
            clusters.append(char)
    # A standalone syllabic n is a nucleus; n elsewhere remains a consonant.
    if len(clusters) == 1 and clusters[0][0].lower() == "n":
        return "", clusters, ""
    positions = [i for i, cluster in enumerate(clusters) if cluster[0].lower() in "aeiou"]
    if not positions or positions != list(range(positions[0], positions[-1] + 1)):
        raise ValueError(f"Expected a single contiguous vowel nucleus in {syllable}")
    start, end = positions[0], positions[-1] + 1
    return "".join(clusters[:start]), clusters[start:end], "".join(clusters[end:])


def vowel_diphthongs(data: pd.DataFrame) -> tuple[str, ...]:
    """
        Identify all diphthongs present in the dataset.

        Args:
            data (pd.DataFrame): The dataset containing syllables.

        Returns:
            tuple[str, ...]: A sorted tuple of unique diphthongs found in the dataset.
    """
    found = set()
    for syllables in data["syllables"]:
        for syllable in ast.literal_eval(syllables) if isinstance(syllables, str) else syllables:
            try:
                parts = vowel_parts(syllable)
            except ValueError:
                continue
            nucleus = "".join(cluster[0].lower() for cluster in parts[1])
            if len(nucleus) == 2 and nucleus[0] != nucleus[1]:
                found.add(nucleus)
    return tuple(sorted(found))


def marked_nucleus(nucleus: str, tones: str, nasal: bool) -> str:
    """
        Return a vowel nucleus with diacritics for tone and nasality.

        Args:
            nucleus (str): The vowel nucleus to mark.
            tones (str): A string representing the tone(s) of the nucleus.
            nasal (bool): A boolean indicating whether the vowel is nasalized.

        Returns:
            str: The marked vowel nucleus with appropriate diacritics.
    """
    return unicodedata.normalize("NFC", "".join(
        vowel + ("\u0328" if nasal else "") + ("\u0301" if tone == "H" else "")
        for vowel, tone in zip(nucleus, tones)
    ))


def length_options(syllable: str, tone: str, nasal: str, settings: VowelLengthSettings, diphthongs: tuple[str, ...]) -> list[str]:
    """Build enabled spellings from the first vowel, tone contour, and nasality."""
    try:
        prefix, clusters, suffix = vowel_parts(syllable)
    except ValueError:
        return []
    if len(clusters) != len(tone) or nasal not in ("O", "N") or set(tone) - {"H", "L"}:
        return []
    if any(("\u0328" in cluster) != (nasal == "N") for cluster in clusters):
        return []
    if any(("\u0301" in cluster) != (level == "H") for cluster, level in zip(clusters, tone)):
        return []

    first = clusters[0][0]
    if first.lower() not in "aeiou":
        return []
    contour = "".join(level for i, level in enumerate(tone) if i == 0 or level != tone[i - 1])
    # A short vowel cannot carry a transition. Keep that omission from
    # giving away that the answer is one of the longer forms.
    if len(contour) > 2 or (settings.short and len(contour) != 1):
        return []
    double_tone = contour if len(contour) == 2 else contour * 2
    options = []

    def add(nucleus: str, tones: str) -> None:
        options.append(unicodedata.normalize("NFC", prefix + marked_nucleus(nucleus, tones, nasal == "N") + suffix))

    if settings.short:
        add(first, contour)
    if settings.long:
        add(first + first.lower(), double_tone)
    for diphthong in diphthongs:
        if diphthong[0] == first.lower():
            dip = first + diphthong[1]
            if settings.diphthong:
                add(dip, double_tone)
            if settings.long_diphthong:
                add(dip + dip[-1], double_tone + double_tone[-1])

    actual = unicodedata.normalize("NFC", syllable)
    return options if len(options) >= 2 and actual in options else []


def make_length_exercise(row: pd.Series, settings: VowelLengthSettings, diphthongs: tuple[str, ...]) -> VowelLengthExercise | None:
    """
        Create a VowelLengthExercise from a dataset row.

        Args:
            row (pd.Series): A row from the dataset containing syllables, tones, and nasality.
            settings (VowelLengthSettings): The settings for vowel length exercises.
            diphthongs (tuple[str, ...]): A tuple of diphthongs present in the dataset.

        Returns:
            VowelLengthExercise | None: A VowelLengthExercise object if valid, otherwise None.
    """
    syllables = ast.literal_eval(row["syllables"]) if isinstance(row["syllables"], str) else row["syllables"]
    tones, nasals = row["tone_profile"], row["nasal_profile"]
    if not (len(syllables) == len(tones) == len(nasals)):
        return None
    prompts, answers, originals, options = [], [], [], []
    for syllable, tone, nasal in zip(syllables, tones, nasals):
        actual = unicodedata.normalize("NFC", syllable)
        choices = length_options(syllable, tone, nasal, settings, diphthongs)
        originals.append(actual)
        if not choices:
            prompts.append(actual + " (not tested)")
            answers.append("P")
            options.append([])
            continue
        random.shuffle(choices)
        parts = vowel_parts(syllable)
        # Keep the known first vowel (including its marks), hiding the remaining vowel form.
        prompts.append(unicodedata.normalize("NFC", parts[0] + parts[1][0] + "*" + parts[2]))
        answers.append(actual)
        options.append(choices)
    if all(answer == "P" for answer in answers):
        return None
    return VowelLengthExercise(
        example_id=str(row.name), syllables_length_prompt=prompts, length_profile=answers,
        original_length_profile=originals, options_profile=options,
        word=row["word"], audio_id=Path(row["local_path"].replace("\\", "/")).stem,
    )


