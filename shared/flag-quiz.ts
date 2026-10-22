import { HATTRICK_WORLD_DETAILS } from './worlddetails.js';

export const FLAG_QUIZ_COUNTRIES = Object.values(HATTRICK_WORLD_DETAILS)
  .filter((country) => country.countryId !== null && country.leagueId !== 15);

export interface FlagQuizOption { leagueId: number; name: string }
export interface FlagQuizQuestion {
  id: string;
  expiresAt: string;
  emoji: string;
  options: FlagQuizOption[];
}
export interface FlagQuizState {
  question: FlagQuizQuestion;
  canAnswer: boolean;
  answer: null | { selectedLeagueId: number; correctLeagueId: number };
  results: null | { total: number; options: Array<{ leagueId: number; count: number }> };
  leaders: Array<{ rank: number; managerName: string; correct: number; attempted: number }>;
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function flagQuizOptions(correctLeagueId: number, random: () => number): FlagQuizOption[] {
  const correct = FLAG_QUIZ_COUNTRIES.find((country) => country.leagueId === correctLeagueId);
  if (!correct) throw new Error('Invalid flag quiz country.');
  const wrong = FLAG_QUIZ_COUNTRIES.filter((country) => country.leagueId !== correctLeagueId);
  const matching = shuffle(wrong.filter((country) => country.leagueName[0] === correct.leagueName[0]), random).slice(0, 2);
  const nearby = shuffle(wrong.filter((country) =>
    Math.abs(country.leagueId - correctLeagueId) <= 20 && !matching.includes(country)), random);
  const choices = [correct, ...matching, ...nearby.slice(0, 5 - matching.length)];
  if (choices.length !== 6) throw new Error('Not enough flag quiz options.');
  return shuffle(choices, random).map((country) => ({ leagueId: country.leagueId, name: country.leagueName }));
}
