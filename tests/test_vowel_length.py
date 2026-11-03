"""Tone-preserving boundary cases for vowel-length distractors."""
import unittest
import unicodedata

from backend.app import VowelLengthSettings, length_pairs


def only(kind):
    return VowelLengthSettings(**{key: key == kind for key in (
        "short_long", "short_diphthong", "long_diphthong", "diphthong_long_final"
    )})


class VowelLengthTests(unittest.TestCase):
    def test_flat_long_vowels_can_shorten_but_contour_tones_cannot(self):
        self.assertEqual(length_pairs("baa", "LL", "O", only("short_long")), [("short_long", "ba")])
        self.assertEqual(length_pairs("b\u00e1\u00e1", "HH", "O", only("short_long")), [("short_long", "b\u00e1")])
        self.assertEqual(length_pairs("b\u00e1a", "HL", "O", only("short_long")), [])
        self.assertEqual(length_pairs("ba\u00e1", "LH", "O", only("short_long")), [])

    def test_shortening_final_diphthong_vowel_preserves_the_final_tone(self):
        self.assertEqual(length_pairs("b\u00e1ii", "HLL", "O", only("diphthong_long_final")), [("diphthong_long_final", "b\u00e1i")])
        self.assertEqual(length_pairs("b\u00e1\u00edi", "HHL", "O", only("diphthong_long_final")), [])
        self.assertEqual(length_pairs("bai\u00ed", "LLH", "O", only("diphthong_long_final")), [])

    def test_long_vs_diphthong_keeps_rising_tone(self):
        pairs = length_pairs("ba\u00e1", "LH", "O", only("long_diphthong"))
        self.assertIn(("long_diphthong", "ba\u00ed"), pairs)
        self.assertTrue(all(kind == "long_diphthong" for kind, _ in pairs))

    def test_nasal_high_vowel_stays_nasal_and_high_in_both_unicode_forms(self):
        original = "b\u0105\u0301"
        for form in ("NFC", "NFD"):
            pairs = length_pairs(unicodedata.normalize(form, original), "H", "N", only("short_long"))
            self.assertEqual(len(pairs), 1)
            self.assertEqual(unicodedata.normalize("NFD", pairs[0][1]), "ba\u0328\u0301a\u0328\u0301")

    def test_inconsistent_or_mixed_nasality_is_not_silently_changed(self):
        self.assertEqual(length_pairs("bai", "LL", "N", only("long_diphthong")), [])
        self.assertEqual(length_pairs("b\u0105i", "LL", "N", only("long_diphthong")), [])
        self.assertEqual(length_pairs("baa", "HL", "O", only("short_long")), [])


if __name__ == "__main__":
    unittest.main()
