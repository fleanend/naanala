import unicodedata
import unittest
from unittest import mock

import pandas as pd

from backend.dataset import load_dataset
from backend.exercises.pitch import (
    DESCENDING_TONES,
    FLAT_TONES,
    RISING_TONES,
    TONE_OPTIONS,
    eligible_pitch_examples,
    make_pitch_exercise,
    tone_enabled,
)
from backend.exercises.vowel_length import (
    length_pairs,
    make_length_exercise,
    marked_nucleus,
    vowel_diphthongs,
    vowel_parts,
)
from backend.schemas import (
    NasalSyllableExercise,
    NasalSyllableSettings,
    PitchSyllableExercise,
    PitchSyllableSettings,
    VowelLengthExercise,
    VowelLengthSettings,
)


class TestVowelLength(unittest.TestCase):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.data = load_dataset().data

    def setUp(self):
        pass

    def test_vowel_parts(self):
        """Vowel parts should return a tuple of (onset, nucleus, coda) for valid syllables and raise ValueError for invalid ones."""
        self.assertRaises(ValueError, vowel_parts, "tst")
        self.assertRaises(ValueError, vowel_parts, "tsato")
        self.assertRaises(ValueError, vowel_parts, "")
        for syllables, _ in self.data[["syllables", "word"]].itertuples(index=False):
            for syllable in syllables:
                parts = vowel_parts(syllable)
                self.assertIsInstance(parts, tuple)
                self.assertEqual(len(parts), 3)
                self.assertIsInstance(parts[0], str)
                self.assertIsInstance(parts[1], list)
                self.assertIsInstance(parts[2], str)
                syllable_reconstructed = parts[0] + "".join(parts[1]) + parts[2]
                self.assertEqual(unicodedata.normalize("NFD", syllable), syllable_reconstructed)

    @mock.patch("backend.exercises.vowel_length.vowel_parts", side_effect=ValueError)
    def test_vowel_diphthongs_error(self, mock_vowel_parts):
        """Vowel diphthongs should return an empty tuple if vowel_parts raises a ValueError."""
        self.assertEqual(vowel_diphthongs(self.data), ())

    def test_vowel_diphthongs(self):
        """Vowel diphthongs should return a sorted tuple of unique diphthongs found in the dataset."""
        # ao only present in triphthongs in the dataset (occurs in many words in reality e.g. naołnish), others don't occur in the language
        self.assertEqual({'ai', 'ei', 'oi'}, set(vowel_diphthongs(self.data)))

    def test_marked_nucleus(self):
        """marked_nucleus should return the correct marked vowel for given nucleus, tone, and nasalization."""
        self.assertEqual(marked_nucleus("a", "H", False), "á")
        self.assertEqual(marked_nucleus("a", "L", False), "a")
        self.assertEqual(marked_nucleus("a", "H", True), "ą́")
        self.assertEqual(marked_nucleus("a", "L", True), "ą")
        self.assertEqual(marked_nucleus("ai", "HL", False), "ái")
        self.assertEqual(marked_nucleus("", "LH", False), "")

    @mock.patch("backend.exercises.vowel_length.vowel_parts", side_effect=ValueError)
    def test_pairs_error(self, mock_vowel_parts):
        """length_pairs should return an empty list if vowel_parts raises a ValueError."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        self.assertEqual(length_pairs("ta", "H", "O", settings, ("ai", "ei", "oi")), [])

    def test_pairs_empty(self):
        """length_pairs should return an empty list if there are problems with tone or nasality."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        self.assertEqual(length_pairs("ta", "L", "T", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("ta", "L", "N", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("ta", "LL", "N", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("ta", "H", "O", settings, ("ai", "ei", "oi")), [])

    def test_pairs(self):
        """length_pairs should return eligible binary contrasts with identical tone and nasality on both options."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=False,
            long_diphthong=False,
            diphthong_long_final=False,
        )
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ai", "ei", "oi")), [('short_long', 'taa')])
        self.assertEqual(length_pairs("taa", "LL", "O", settings, ("ai", "ei", "oi")), [('short_long', 'ta')])
        self.assertEqual(length_pairs("táh", "H", "O", settings, ("ai", "ei", "oi")), [('short_long', 'tááh')])
        self.assertEqual(length_pairs("tááh", "HH", "O", settings, ("ai", "ei", "oi")), [('short_long', 'táh')])
        self.assertEqual(length_pairs("tą", "L", "N", settings, ("ai", "ei", "oi")), [('short_long', 'tąą')])
        self.assertEqual(length_pairs("tąą", "LL", "N", settings, ("ai", "ei", "oi")), [('short_long', 'tą')])
        self.assertEqual(length_pairs("tą́h", "H", "N", settings, ("ai", "ei", "oi")), [('short_long', 'tą́ą́h')])
        self.assertEqual(length_pairs("tą́ą́h", "HH", "N", settings, ("ai", "ei", "oi")), [('short_long', 'tą́h')])
        self.assertEqual(length_pairs("táa", "HL", "O", settings, ("ai", "ei", "oi")), [])

        settings = VowelLengthSettings(
            question_count=1,
            short_long=False,
            short_diphthong=True,
            long_diphthong=False,
            diphthong_long_final=False,
        )
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ai", "ei", "oi")), [('short_diphthong', 'tai')])
        self.assertEqual(length_pairs("tai", "LL", "O", settings, ("ai", "ei", "oi")), [('short_diphthong', 'ta')])
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ei", "oi")), [])
        self.assertEqual(length_pairs("tái", "HL", "O", settings, ("ai", "ei", "oi")), [])
        
        settings = VowelLengthSettings(
            question_count=1,
            short_long=False,
            short_diphthong=False,
            long_diphthong=True,
            diphthong_long_final=False,
        )
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("taa", "LL", "O", settings, ("ai", "ei", "oi")), [('long_diphthong', 'tai')])
        self.assertEqual(length_pairs("tai", "LL", "O", settings, ("ai", "ei", "oi")), [('long_diphthong', 'taa')])

        settings = VowelLengthSettings(
            question_count=1,
            short_long=False,
            short_diphthong=False,
            long_diphthong=False,
            diphthong_long_final=True,
        )
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("taa", "LL", "O", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("tai", "LL", "O", settings, ("ai", "ei", "oi")), [('diphthong_long_final', 'taii')])
        self.assertEqual(length_pairs("taai", "LLL", "O", settings, ("ai", "ei", "oi")), [])
        self.assertEqual(length_pairs("taii", "LLL", "O", settings, ("ai", "ei", "oi")), [('diphthong_long_final', 'tai')])
        self.assertEqual(length_pairs("taíi", "LHL", "O", settings, ("ai", "ei", "oi")), [])

        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        self.assertEqual(length_pairs("ta", "L", "O", settings, ("ai", "ei", "oi")), [('short_long', 'taa'), ('short_diphthong', 'tai')])
        self.assertEqual(length_pairs("taa", "LL", "O", settings, ("ai", "ei", "oi")), [('short_long', 'ta'), ('long_diphthong', 'tai')])
        self.assertEqual(length_pairs("tai", "LL", "O", settings, ("ai", "ei", "oi")), [('short_diphthong', 'ta'), ('long_diphthong', 'taa'), ('diphthong_long_final', 'taii')])
        self.assertEqual(length_pairs("taii", "LLL", "O", settings, ("ai", "ei", "oi")), [('diphthong_long_final', 'tai')])

    def test_make_length_data_error(self):
        """make_length_exercise should return None if the syllables, tones, and nasals lengths do not match."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        diphthongs = ("ai", "ei", "oi")
        row = pd.Series({
            "syllables": ["ta", "taa"],
            "tone_profile": ["L"],
            "nasal_profile": ["O", "O"],
        })
        exercise = make_length_exercise(row, settings, diphthongs)
        self.assertIsNone(exercise)

    @mock.patch("backend.exercises.vowel_length.length_pairs", return_value=[])
    def test_make_length_data_no_pairs(self, mock_length_pairs):
        """make_length_exercise should return None if length_pairs returns an empty list for all syllables."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        diphthongs = ("ai", "ei", "oi")
        row = pd.Series({
            "syllables": ["ta", "taa"],
            "tone_profile": ["L", "L"],
            "nasal_profile": ["O", "O"],
        })
        exercise = make_length_exercise(row, settings, diphthongs)
        self.assertIsNone(exercise)

    def test_make_length_exercise(self):
        """make_length_exercise should return a VowelLengthExercise object with the correct prompts, answers, originals, options, and contrasts."""
        settings = VowelLengthSettings(
            question_count=1,
            short_long=True,
            short_diphthong=True,
            long_diphthong=True,
            diphthong_long_final=True,
        )
        diphthongs = ("ai", "ei", "oi")
        for _, row in self.data.iterrows():
            exercise = make_length_exercise(row, settings, diphthongs)
            if exercise is not None:
                self.assertIsInstance(exercise, VowelLengthExercise)
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.length_profile))
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.original_length_profile))
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.options_profile))
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.contrast_profile))

class TestPitch(unittest.TestCase):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.data = load_dataset().data

    def setUp(self):
        pass

    def test_tone_enabled(self):
        """tone_enabled should return True if the tone is allowed by the settings, and False otherwise."""
        for tone in FLAT_TONES:
            settings = PitchSyllableSettings(flat=True, rising=False, descending=False)
            self.assertTrue(tone_enabled(tone, settings))
            settings = PitchSyllableSettings(flat=False, rising=True, descending=True)
            self.assertFalse(tone_enabled(tone, settings))

        for tone in RISING_TONES:
            settings = PitchSyllableSettings(flat=False, rising=True, descending=False)
            self.assertTrue(tone_enabled(tone, settings))
            settings = PitchSyllableSettings(flat=True, rising=False, descending=True)
            self.assertFalse(tone_enabled(tone, settings))

        for tone in DESCENDING_TONES:
            settings = PitchSyllableSettings(flat=False, rising=False, descending=True)
            self.assertTrue(tone_enabled(tone, settings))
            settings = PitchSyllableSettings(flat=True, rising=True, descending=False)
            self.assertFalse(tone_enabled(tone, settings))

    def test_eligible_pitch_examples(self):
        """eligible_pitch_examples should return a DataFrame of examples that have valid tone profiles and are allowed by the settings."""
        settings = PitchSyllableSettings(
            question_count=1,
            monophthongs=True,
            diphthongs_long_vowels=True,
            triphthongs_diphthongs_with_long_vowels=True,
            flat=True,
            rising=True,
            descending=True,
        )
        df = pd.DataFrame({
            "syllables_no_tone": [["ta", "taa"], ["ta", "tai"], ["ta", 1], ["taaaaa", "ta"], ["taa", "ta"], ["ta", "ta"]],
            "tone_profile": [[], ["LH", "HL", "HH"], ["HH", "LL"], ["HHHHH", "H"], [1, "L"], ["H", "T"]],
        })
        eligible = eligible_pitch_examples(df, settings)
        self.assertEqual(len(eligible), 0)

        examples = [
            {
                "syllables_no_tone": ["ta", "taa"],
                "tone_profile": ["H", "HH"],
                "outputs": [
                    {
                        "test_id": 1,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            monophthongs=True,
                            diphthongs_long_vowels=True,
                            flat=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 2,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            monophthongs=False,
                            diphthongs_long_vowels=True,
                            flat=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 3,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            monophthongs=True,
                            diphthongs_long_vowels=True,
                            flat=False,
                        ),
                        "expected": 0
                    },
                    {
                        "test_id": 4,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            monophthongs=True,
                            diphthongs_long_vowels=False,
                            flat=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 5,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            monophthongs=False,
                            diphthongs_long_vowels=False,
                            flat=True,
                        ),
                        "expected": 0
                    },
                ]
             },
            {
                "syllables_no_tone": ["taa", "tai"],
                "tone_profile": ["LH", "HL"],
                "outputs": [
                    {
                        "test_id": 6,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            rising=True,
                            descending=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 7,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            rising=True,
                            descending=False,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 8,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            rising=False,
                            descending=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 9,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            rising=False,
                            descending=False,
                        ),
                        "expected": 0
                    },
                    {
                        "test_id": 10,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            diphthongs_long_vowels=False,
                        ),
                        "expected": 0
                    }
                ]
            },
            {
                "syllables_no_tone": ["haii"],
                "tone_profile": ["LLL"],
                "outputs": [
                    {
                        "test_id": 11,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            triphthongs_diphthongs_with_long_vowels=True,
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 12,
                        "settings": PitchSyllableSettings(
                            question_count=1,
                            triphthongs_diphthongs_with_long_vowels=False,
                        ),
                        "expected": 0
                    }
                ]
            }
        ]

        for example in examples:
            for output in example["outputs"]:
                df = pd.DataFrame([{
                    "syllables_no_tone": example["syllables_no_tone"],
                    "tone_profile": example["tone_profile"]
                }])
                eligible = eligible_pitch_examples(df, output["settings"])
                self.assertEqual(len(eligible), output["expected"], f"Test ID {output['test_id']} failed: expected {output['expected']} eligible examples, got {len(eligible)}.")


    @mock.patch("backend.exercises.pitch.tone_enabled", return_value=False)
    def test_make_pitch_no_tone_enabled(self, mock_tone_enabled):
        """make_pitch_exercise should have no options if no tones are enabled."""
        settings = PitchSyllableSettings(
            question_count=1,
            monophthongs=True,
            diphthongs_long_vowels=True,
            triphthongs_diphthongs_with_long_vowels=True,
            flat=True,
            rising=True,
            descending=True,
        )
        row = pd.Series({
            "syllables_no_tone": ["ta", "taa"],
            "tone_profile": ["L", "LL"],
            "word": "tataa",
            "local_path": "somepath"
        })
        exercise = make_pitch_exercise(row, settings)
        self.assertFalse(exercise.options_profile[0])
        self.assertFalse(exercise.options_profile[1])

    def test_make_pitch_exercise(self):
        """make_pitch_exercise should return a PitchSyllableExercise object with the correct prompts, answers, originals, options."""
        settings = PitchSyllableSettings(
            question_count=1,
            monophthongs=True,
            diphthongs_long_vowels=True,
            triphthongs_diphthongs_with_long_vowels=True,
            flat=True,
            rising=True,
            descending=True,
        )
        for _, row in self.data.iterrows():
            exercise = make_pitch_exercise(row, settings)
            if exercise is not None:
                self.assertIsInstance(exercise, PitchSyllableExercise)
                self.assertEqual(len(exercise.syllables_no_pitch), len(exercise.tone_profile))
                self.assertEqual(len(exercise.syllables_no_pitch), len(exercise.original_tone_profile))
                self.assertEqual(len(exercise.syllables_no_pitch), len(exercise.options_profile))