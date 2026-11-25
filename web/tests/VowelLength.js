class VowelLength extends Exercise {
  static title = 'Vowel Length';
  static endpoint = '/api/tests/vowel-length/session';
  static syllablesField = 'syllables_length_prompt';
  static profileField = 'length_profile';
  static originalField = 'original_length_profile';
  static answerLabel = 'vowel form';
  static instructions = 'Listen and choose the matching spelling for each tested syllable. The first vowel stays visible; * marks the unknown vowel form. The choices have the same tone and nasality, shown by their vowel marks. An acute accent marks high tone; an ogonek marks nasality. Unmarked vowels have low tone and are oral.';
  static vowelForms = {
    short: 'Short vowel (a)',
    long: 'Long vowel (aa)',
    diphthong: 'Diphthong (ai)',
    long_diphthong: 'Long diphthong (aii)'
  };
  static validChoice = value => typeof value === 'string' && value.length > 0 && value !== 'P';
  static choiceLabel = value => value;
  static validateExercise = value => {
    const result = Exercise.validateExercise(value, VowelLength);
    result.length_profile.forEach((answer, i) => {
      if (answer === 'P') return;
      const options = result.options_profile[i];
      if (options.length < 2 || new Set(options).size !== options.length) throw new Error('Expected multiple distinct vowel forms.');
    });
    return result;
  };
  static review = (item, preferences) => Exercise.review(item, preferences, VowelLength);
  static answerGraph = () => '';

  sessionSettings() {
    const selected = this.options.vowelForms ?? Object.keys(VowelLength.vowelForms);
    return Object.fromEntries(Object.keys(VowelLength.vowelForms).map(key => [key, selected.includes(key)]));
  }
}
