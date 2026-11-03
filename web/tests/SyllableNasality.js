// Oral/nasal classification shares the same session and scoring lifecycle as pitch.
class SyllableNasality extends Exercise {
  static title = 'Syllable Nasality';
  static endpoint = '/api/tests/syllable-nasal/session';
  static syllablesField = 'syllables_no_nasals';
  static profileField = 'nasal_profile';
  static originalField = 'original_nasal_profile';
  static answerLabel = 'nasality';
  static instructions = 'Listen, then choose Oral or Nasal for each syllable.';
  static validChoice = value => value === 'O' || value === 'N';
  static choiceLabel = value => ({ O: 'Oral', N: 'Nasal' }[value] ?? value);
  static validateExercise = value => Exercise.validateExercise(value, SyllableNasality);
  static review = (item, preferences) => Exercise.review(item, preferences, SyllableNasality);
  static answerGraph = () => '';
}
