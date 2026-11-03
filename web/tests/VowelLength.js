// Binary spelling contrasts; tone and nasality are supplied in each prompt and option.
class VowelLength extends Exercise {
  static title = 'Vowel Length';
  static endpoint = '/api/tests/vowel-length/session';
  static syllablesField = 'syllables_length_prompt';
  static profileField = 'length_profile';
  static originalField = 'original_length_profile';
  static answerLabel = 'vowel form';
  static instructions = 'Listen and choose the matching spelling for each tested syllable. The first vowel stays visible; * marks the unknown vowel form. Both choices have the same tone and nasality, shown by their vowel marks. An acute accent marks high tone; an ogonek marks nasality. Unmarked vowels have low tone and are oral.';
  static contrasts = {
    short_long: 'Short vowel vs long vowel (a / aa)',
    short_diphthong: 'Short vowel vs diphthong with the same first vowel (a / ai)',
    long_diphthong: 'Long vowel vs diphthong with the same first vowel (aa / ai)',
    diphthong_long_final: 'Diphthong vs the same diphthong with a long final vowel (ai / aii)'
  };
  static validChoice = value => typeof value === 'string' && value.length > 0 && value !== 'P';
  static choiceLabel = value => value;
  static validateExercise = value => {
    const result = Exercise.validateExercise(value, VowelLength);
    if (!Array.isArray(value.contrast_profile) || value.contrast_profile.length !== result.length_profile.length) throw new Error('Invalid contrast profile.');
    result.length_profile.forEach((answer, i) => {
      if (answer === 'P') return;
      const options = result.options_profile[i];
      if (options.length !== 2 || new Set(options).size !== 2 || !Object.hasOwn(VowelLength.contrasts, value.contrast_profile[i])) throw new Error('Expected a binary vowel contrast.');
    });
    return { ...result, contrast_profile: value.contrast_profile };
  };
  static review = (item, preferences) => Exercise.review(item, preferences, VowelLength);
  static answerGraph = () => '';

  sessionSettings() {
    const selected = this.options.contrasts ?? Object.keys(VowelLength.contrasts);
    return Object.fromEntries(Object.keys(VowelLength.contrasts).map(key => [key, selected.includes(key)]));
  }

  answerDetails() { return { contrasts: this.state.exercise.contrast_profile }; }
}
