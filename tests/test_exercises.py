import unicodedata
import unittest
from unittest import mock

import pandas as pd

from backend.dataset import load_dataset
from backend.exercises.aspiration import (
    ALVEOLAR_AFFRICATES,
    ALVEOLAR_LATERAL_AFFRICATES,
    ALVEOLAR_STOPS,
    ASPIRATED,
    EJECTIVES,
    POSTALVEOLAR_AFFRICATES,
    UNASPIRATED,
    VELAR_STOPS,
    eligible_aspiration_examples,
    make_aspiration_exercise,
    onset_enabled,
)
from backend.exercises.nasality import (
    eligible_nasality_examples,
    make_nasality_exercise,
)
from backend.exercises.pitch import (
    DESCENDING_TONES,
    FLAT_TONES,
    RISING_TONES,
    eligible_pitch_examples,
    make_pitch_exercise,
    tone_enabled,
)
from backend.exercises.vowel_length import (
    length_options,
    make_length_exercise,
    marked_nucleus,
    vowel_diphthongs,
    vowel_parts,
)
from backend.schemas import (
    AspirationExercise,
    AspirationSyllableSettings,
    NasalSyllableExercise,
    NasalSyllableSettings,
    PitchSyllableExercise,
    PitchSyllableSettings,
    VowelLengthExercise,
    VowelLengthSettings,
)

# add options checking in make_x_exercise

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

    def test_length_options(self):
        settings = VowelLengthSettings()
        for syllable, tone in (("ta", "L"), ("taa", "LL"), ("tai", "LL"), ("taii", "LLL")):
            with self.subTest(syllable=syllable):
                self.assertEqual(length_options(syllable, tone, "O", settings, ("ai", "ei")), ["ta", "taa", "tai", "taii"])

    def test_length_options_preserve_marks_and_consonants(self):
        self.assertEqual(
            length_options("t\u0105\u0301h", "H", "N", VowelLengthSettings(), ("ai",)),
            ["t\u0105\u0301h", "t\u0105\u0301\u0105\u0301h", "t\u0105\u0301\u012f\u0301h", "t\u0105\u0301\u012f\u0301\u012f\u0301h"],
        )
        self.assertEqual(
            length_options("t\u00e1ii", "HLL", "O", VowelLengthSettings(short=False), ("ai",)),
            ["t\u00e1a", "t\u00e1i", "t\u00e1ii"],
        )
        self.assertEqual(length_options("t\u00e1ii", "HLL", "O", VowelLengthSettings(), ("ai",)), [])

    def test_length_options_respect_enabled_forms(self):
        settings = VowelLengthSettings(long=False, diphthong=False)
        self.assertEqual(length_options("ta", "L", "O", settings, ("ai",)), ["ta", "taii"])
        self.assertEqual(length_options("taii", "LLL", "O", settings, ("ai",)), ["ta", "taii"])
        self.assertEqual(length_options("taa", "LL", "O", settings, ("ai",)), [])
        self.assertEqual(length_options("tai", "LL", "O", settings, ("ai",)), [])
        self.assertEqual(length_options("ta", "L", "O", settings, ("ei",)), [])

    def test_length_options_reject_invalid_syllables_and_metadata(self):
        settings = VowelLengthSettings()
        for syllable, tone, nasal in (
            ("tst", "L", "O"), ("ta", "L", "T"), ("ta", "L", "N"),
            ("ta", "LL", "O"), ("ta", "H", "O"), ("ta", "X", "O"),
            ("taai", "LLL", "O"), ("ta\u00edi", "LHL", "O"),
        ):
            with self.subTest(syllable=syllable, tone=tone, nasal=nasal):
                self.assertEqual(length_options(syllable, tone, nasal, settings, ("ai",)), [])

    def test_length_options_skip_syllabic_n(self):
        self.assertEqual(length_options("n", "L", "O", VowelLengthSettings(), ("ai",)), [])

    def test_make_length_data_error(self):
        row = pd.Series({"syllables": ["ta", "taa"], "tone_profile": ["L"], "nasal_profile": ["O", "O"]})
        self.assertIsNone(make_length_exercise(row, VowelLengthSettings(), ("ai",)))

    def test_make_length_exercise(self):
        row = pd.Series({
            "word": "tataataitaii",
            "syllables": ["ta", "taa", "tai", "taii"],
            "tone_profile": ["L", "LL", "LL", "LLL"],
            "nasal_profile": ["O"] * 4,
            "local_path": "path/to/somewhere",
        })
        exercise = make_length_exercise(row, VowelLengthSettings(), ("ai",))
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_length_prompt, ["ta*"] * 4)
        self.assertEqual(exercise.length_profile, row["syllables"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [row["syllables"]] * 4)

        settings = VowelLengthSettings(diphthong=False, long_diphthong=False)
        exercise = make_length_exercise(row, settings, ("ai",))
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.length_profile, ["ta", "taa", "P", "P"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [["ta", "taa"], ["ta", "taa"], [], []])
        self.assertIsNone(make_length_exercise(row, VowelLengthSettings(long=False, diphthong=False, long_diphthong=False), ("ai",)))

    def test_make_length_exercise_data(self):
        """make_length_exercise should return a VowelLengthExercise object with the correct shapes for prompts, answers, originals, and options for each element in the dataset."""
        settings = VowelLengthSettings()
        diphthongs = ("ai", "ei", "oi")
        for _, row in self.data.iterrows():
            exercise = make_length_exercise(row, settings, diphthongs)
            if exercise is not None:
                self.assertIsInstance(exercise, VowelLengthExercise)
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.length_profile))
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.original_length_profile))
                self.assertEqual(len(exercise.syllables_length_prompt), len(exercise.options_profile))

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
        row = pd.Series({
            "word": "tataataitaii",
            "syllables": ["ta", "taa", "tai", "taii"],
            "syllables_no_tone": ["ta", "taa", "tai", "taii"],
            "tone_profile": ["L", "LL", "LL", "LLL"],
            "nasal_profile": ["O"] * 4,
            "local_path": "path/to/somewhere",
        })
        exercise = make_pitch_exercise(row, PitchSyllableSettings())
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_no_pitch, row["syllables"])
        self.assertEqual(exercise.tone_profile, row["tone_profile"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [['H', 'L'], ['HH', 'HL', 'LH', 'LL'], ['HH', 'HL', 'LH', 'LL'], ['HHH', 'HHL', 'HLL', 'LHH', 'LLH', 'LLL']])

        exercise = make_pitch_exercise(row, PitchSyllableSettings(descending=False, triphthongs_diphthongs_with_long_vowels=False))
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_no_pitch, row["syllables"])
        self.assertEqual(exercise.tone_profile, ["L", "LL", "LL", "P"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [['H', 'L'], ['HH','LH', 'LL'], ['HH', 'LH', 'LL'], []])


    def test_make_pitch_exercise_data(self):
        """make_pitch_exercise should return a PitchSyllableExercise object with the correct shape prompts, answers, originals, options for each element in the dataset."""
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

class TestNasality(unittest.TestCase):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.data = load_dataset().data

    def setUp(self):
        pass

    def test_eligible_nasality_examples(self):
        """eligible_nasality_examples should filter out problematic examples and create a dataset seeded with negative samples"""
        df_input = pd.DataFrame({
            "word" : ["tatan", "tatan", "tąta", "tątą", "tata"],
            "n_in_syllables" : [True, True, False, False, False],
            "nasal_profile" : [["O", "O"], ["O", "O"], ["N", "O"], ["N", "N"], ["O", "O"]]
        })

        df_expected = pd.DataFrame({
            "word" : ["tąta", "tątą", "tata"],
            "n_in_syllables" : [False, False, False],
            "nasal_profile" : [["N", "O"], ["N", "N"], ["O", "O"]]
        })

        df_output = eligible_nasality_examples(df_input, NasalSyllableSettings()).reset_index(drop=True)
        pd.testing.assert_frame_equal(df_expected, df_output)

    def test_make_nasality_exercise(self):
        row = pd.Series({
            "word": "tątąątaitaii",
            "syllables": ["tą", "tąą", "tai", "taii"],
            "syllables_no_nasals": ["ta", "taa", "tai", "taii"],
            "tone_profile": ["L", "LL", "LL", "LLL"],
            "nasal_profile": ["N", "N", "O", "O"],
            "local_path": "path/to/somewhere",
        })
        exercise = make_nasality_exercise(row, NasalSyllableSettings())
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_no_nasals, row["syllables_no_nasals"])
        self.assertEqual(exercise.nasal_profile, row["nasal_profile"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [['N', 'O']] * 4)

    def test_make_nasality_exercise_data(self):
        """make_nasality_exercise should return a NasalSyllableExercise object with the correct shape for prompts, answers, originals, options for each element in the dataset."""
        settings = NasalSyllableSettings(
            question_count=1
        )
        for _, row in self.data.iterrows():
            exercise = make_nasality_exercise(row, settings)
            if exercise is not None:
                self.assertIsInstance(exercise, NasalSyllableExercise)
                self.assertEqual(len(exercise.syllables_no_nasals), len(exercise.nasal_profile))
                self.assertEqual(len(exercise.syllables_no_nasals), len(exercise.original_nasal_profile))
                self.assertEqual(len(exercise.syllables_no_nasals), len(exercise.options_profile))

class TestAspiration(unittest.TestCase):
    def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.data = load_dataset().data
    
    def setUp(self):
        pass

    def test_onset_enabled(self):
        """onset_enabled should return True if the onset is allowed by the settings, and False otherwise."""

        self.assertFalse(onset_enabled("bad", AspirationSyllableSettings()))

        for onset in ALVEOLAR_STOPS:
            settings = AspirationSyllableSettings(alveolar_stop=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(alveolar_stop=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in VELAR_STOPS:
            settings = AspirationSyllableSettings(velar_stop=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(velar_stop=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in ALVEOLAR_AFFRICATES:
            settings = AspirationSyllableSettings(alveolar_affricate=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(alveolar_affricate=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in POSTALVEOLAR_AFFRICATES:
            settings = AspirationSyllableSettings(postalveolar_affricate=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(postalveolar_affricate=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in ALVEOLAR_LATERAL_AFFRICATES:
            settings = AspirationSyllableSettings(alveolar_lateral_affricate=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(alveolar_lateral_affricate=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in UNASPIRATED:
            settings = AspirationSyllableSettings(unaspirated=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(unaspirated=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in ASPIRATED:
            settings = AspirationSyllableSettings(aspirated=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(aspirated=False)
            self.assertFalse(onset_enabled(onset, settings))

        for onset in EJECTIVES:
            settings = AspirationSyllableSettings(ejective=True)
            self.assertTrue(onset_enabled(onset, settings))
            settings = AspirationSyllableSettings(ejective=False)
            self.assertFalse(onset_enabled(onset, settings))

    def test_eligible_aspiration_examples(self):
        """eligible_aspiration_examples should return a DataFrame of examples that have valid set of syllables and are allowed by the settings."""
        settings = AspirationSyllableSettings(
            question_count=1
        )
        df = pd.DataFrame({
            "syllables": [None, ["ta", 1], ["ba"]]
        })
        eligible = eligible_aspiration_examples(df, settings)
        self.assertEqual(len(eligible), 0)

        examples = [
            {
                "syllables": ["chʼa", "jin"],
                "outputs": [
                    {
                        "test_id": 1,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=True,
                            unaspirated=True
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 2,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=False,
                            unaspirated=True
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 3,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=False,
                            unaspirated=False
                        ),
                        "expected": 0
                    },
                    {
                        "test_id": 4,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=True,
                            unaspirated=False
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 5,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=False,
                            ejective=True,
                            unaspirated=True
                        ),
                        "expected": 0
                    },
                ]
            },
            {
                "syllables": ["chʼa", "bin"],
                "outputs": [
                    {
                        "test_id": 6,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=True,
                            unaspirated=True
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 7,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=False,
                            unaspirated=True
                        ),
                        "expected": 0
                    },
                    {
                        "test_id": 8,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=False,
                            unaspirated=False
                        ),
                        "expected": 0
                    },
                    {
                        "test_id": 9,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=True,
                            ejective=True,
                            unaspirated=False
                        ),
                        "expected": 1
                    },
                    {
                        "test_id": 10,
                        "settings": AspirationSyllableSettings(
                            question_count=1,
                            postalveolar_affricate=False,
                            ejective=True,
                            unaspirated=True
                        ),
                        "expected": 0
                    },
                ]
            },
                        
        ]

        for example in examples:
            for output in example["outputs"]:
                df = pd.DataFrame([{
                    "syllables": example["syllables"]
                }])
                eligible = eligible_aspiration_examples(df, output["settings"])
                self.assertEqual(len(eligible), output["expected"], f"Test ID {output['test_id']} failed: expected {output['expected']} eligible examples, got {len(eligible)}.")

    @mock.patch("backend.exercises.aspiration.onset_enabled", return_value=False)
    def test_make_aspiration_no_onset_enabled(self, mock_onset_enabled):
        """make_aspiration_exercise should have no options if no tones are enabled."""
        settings = AspirationSyllableSettings(
            question_count=1,
        )
        row = pd.Series({
            "syllables": ["ta", "taa"],
            "word": "tataa",
            "local_path": "somepath"
        })
        exercise = make_aspiration_exercise(row, settings)
        self.assertFalse(exercise.options_profile[0])
        self.assertFalse(exercise.options_profile[1])

    def test_make_aspiration_exercise(self):
        row = pd.Series({
            "word": "takaatsʼaidaii",
            "syllables": ["ta", "kaa", "tsʼai", "daii"],
            "local_path": "path/to/somewhere",
        })
        exercise = make_aspiration_exercise(row, AspirationSyllableSettings())
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_aspiration_prompt, ["Da", "Gaa", "DZai", "Daii"])
        self.assertEqual(exercise.aspiration_profile, row["syllables"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [['da', 'ta', 'tʼa'], ['gaa', 'kaa', 'kʼaa'], ['dzai', 'tsai', 'tsʼai'], ['daii', 'taii', 'tʼaii']])

        exercise = make_aspiration_exercise(row, AspirationSyllableSettings(alveolar_stop=False, alveolar_affricate=False))
        self.assertIsNotNone(exercise)
        assert exercise is not None
        self.assertEqual(exercise.syllables_aspiration_prompt, ["ta", "Gaa", "tsʼai", "daii"])
        self.assertEqual(exercise.aspiration_profile, ["P", "kaa", "P", "P"])
        self.assertEqual(list(map(sorted, exercise.options_profile)), [[], ['gaa', 'kaa', 'kʼaa'], [], []])

    def make_aspiration_exercise_data(self):
        """make_pitch_exercise should return a AspirationExercise object with the correct shape for prompts, answers, originals, options for each element of the dataset."""
        settings = AspirationSyllableSettings(
            question_count=1,
        )
        for _, row in self.data.iterrows():
            exercise = make_aspiration_exercise(row, settings)
            if exercise is not None:
                self.assertIsInstance(exercise, AspirationExercise)
                self.assertEqual(len(exercise.aspiration_profile), len(exercise.syllables_aspiration_prompt))
                self.assertEqual(len(exercise.aspiration_profile), len(exercise.aspiration_profile))
                self.assertEqual(len(exercise.aspiration_profile), len(exercise.options_profile))
