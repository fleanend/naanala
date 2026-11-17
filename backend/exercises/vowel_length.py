"""Vowel-length parsing, contrasts, and exercise generation."""

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


def length_pairs(syllable: str, tone: str, nasal: str, settings: VowelLengthSettings, diphthongs: tuple[str, ...]) -> list[tuple[str, str]]:
    """
        Return eligible binary contrasts with identical tone and nasality on both options.
        
        Args:
            syllable (str): The syllable to analyze.
            tone (str): A string representing the tone(s) of the syllable.
            nasal (str): A string indicating the nasality of the syllable ("O" for oral, "N" for nasal).
            settings (VowelLengthSettings): The settings for vowel length exercises.
            diphthongs (tuple[str, ...]): A tuple of diphthongs present in the dataset.

        Returns:
            list[tuple[str, str]]: A list of tuples, each containing the type of contrast and the alternate syllable.
        """
    try:
        parts = vowel_parts(syllable)
    except ValueError:
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
    dips = diphthongs
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
    elif len(nucleus) == 3 and nucleus[0] != nucleus[1] and nucleus[1] == nucleus[2] and nucleus[:2] in dips:  # noqa: SIM102
        # Shortening the final vowel must not remove a tone transition.
        if tone[1] == tone[2]:
            add("diphthong_long_final", nucleus[:2], tone[:2])
    return alternatives


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
    prompts, answers, originals, options, contrasts = [], [], [], [], []
    for syllable, tone, nasal in zip(syllables, tones, nasals):
        actual = unicodedata.normalize("NFC", syllable)
        pairs = length_pairs(syllable, tone, nasal, settings, diphthongs)
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


