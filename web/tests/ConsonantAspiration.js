class ConsonantAspiration extends Exercise {
  static title = 'Consonant Aspiration';
  static endpoint = '/api/tests/aspiration/session';
  static syllablesField = 'syllables_aspiration_prompt';
  static profileField = 'aspiration_profile';
  static originalField = 'original_aspiration_profile';
  static answerLabel = 'syllable';
  static instructions = 'Listen and choose the matching spelling for each tested syllable. Uppercase letters mark the consonant you need to identify.';
  static settingGroups = {
    'Consonant groups': {
      alveolar_stop: 'Alveolar stops (d, t, tʼ)',
      velar_stop: 'Velar stops (g, k, kʼ)',
      alveolar_affricate: 'Alveolar affricates (dz, ts, tsʼ)',
      postalveolar_affricate: 'Postalveolar affricates (j, ch, chʼ)',
      alveolar_lateral_affricate: 'Lateral affricates (dl, tł, tłʼ)'
    },
    'Aspiration types': {
      unaspirated: 'Unaspirated',
      aspirated: 'Aspirated',
      ejective: 'Ejective'
    }
  };
  static settingKeys = Object.values(this.settingGroups).flatMap(group => Object.keys(group));
  static validChoice = value => typeof value === 'string' && value.length > 0 && value !== 'P';
  static choiceLabel = value => value;
  static validateExercise = value => Exercise.validateExercise(value, ConsonantAspiration);
  static review = (item, preferences) => Exercise.review(item, preferences, ConsonantAspiration);
  static answerGraph = () => '';

  sessionSettings() {
    const { settingKeys } = ConsonantAspiration;
    const selected = this.options.aspirationCategories ?? settingKeys;
    return Object.fromEntries(settingKeys.map(key => [key, selected.includes(key)]));
  }
}
