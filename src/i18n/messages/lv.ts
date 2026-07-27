import en from './en';

const messages = {
  ...en,
  common: {
    ...en.common,
    language: 'Valoda',
    english: 'Angļu',
    latvian: 'Latviešu',
  },
} as const;

export default messages;
