import { HATTRICK_WORLD_DETAILS } from './worlddetails.js';

// Australia is absent from current world details; keep it excluded if added later.
const EXCLUDED_FLAG_QUIZ_COUNTRIES = new Set([
  'Australia', 'Belgium', 'Brazil', 'Canada', 'Czechia', 'Denmark',
  'England', 'Finland', 'France', 'Germany', 'Greece', 'Iceland',
  'India', 'Italy', 'Jamaica', 'Japan', 'Netherlands',
  'Northern Ireland', 'Norway', 'Poland', 'Portugal', 'Romania',
  'Russia', 'Scotland', 'Spain', 'Sweden', 'Switzerland', 'Turkey',
  'Ukraine', 'USA', 'Wales',
]);

export const FLAG_QUIZ_COUNTRIES = Object.values(HATTRICK_WORLD_DETAILS)
  .filter((country) => country.countryId !== null && country.leagueId !== 15 &&
    !EXCLUDED_FLAG_QUIZ_COUNTRIES.has(country.leagueName));

export interface FlagQuizOption { leagueId: number; name: string }
export interface FlagQuizQuestion {
  id: string;
  expiresAt: string;
  emoji: string;
  options: FlagQuizOption[];
}
export interface FlagQuizLeader {
  rank: number;
  managerId: number;
  managerName: string;
  avatar: { backgroundImage: string; layers?: Array<{ x?: number; y?: number; image: string }> } | null;
  countryId: number | null;
  countryName: string | null;
  correct: number;
  attempted: number;
}
export interface FlagQuizLeaderboard {
  month: string;
  leaders: FlagQuizLeader[];
}
export interface FlagQuizState {
  question: FlagQuizQuestion;
  canAnswer: boolean;
  answer: null | { selectedLeagueId: number; correctLeagueId: number };
  results: null | { total: number; options: Array<{ leagueId: number; count: number }> };
  leaderboards: { current: FlagQuizLeaderboard; previous: FlagQuizLeaderboard };
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
  const sameInitial = wrong.filter((country) => country.leagueName[0] === correct.leagueName[0]);
  const matchingCount = Math.floor(random() * (Math.min(3, sameInitial.length) + 1));
  const nonMatching = wrong.filter((country) => country.leagueName[0] !== correct.leagueName[0]);
  const matching = shuffle(
    sameInitial,
    random,
  ).slice(0, matchingCount);
  const nearby = nonMatching
    .filter((country) => Math.abs(country.leagueId - correctLeagueId) <= 10)
    .sort((left, right) => Math.abs(left.leagueId - correctLeagueId) - Math.abs(right.leagueId - correctLeagueId));
  const sameContinent = nearby.filter((country) => country.continent === correct.continent);
  const rankedChoiceCount = 5 - matching.length;
  const sameContinentChoices = sameContinent.slice(0, Math.min(3, rankedChoiceCount));
  const rankedChoices = [
    ...sameContinentChoices,
    ...nearby
      .filter((country) => !sameContinentChoices.includes(country))
      .slice(0, rankedChoiceCount - sameContinentChoices.length),
  ];
  if (rankedChoices.length < rankedChoiceCount) {
    rankedChoices.push(...nonMatching
      .filter((country) => !nearby.includes(country))
      .sort((left, right) => Math.abs(left.leagueId - correctLeagueId) - Math.abs(right.leagueId - correctLeagueId))
      .slice(0, rankedChoiceCount - rankedChoices.length));
  }
  const choices = [correct, ...matching, ...rankedChoices];
  if (choices.length !== 6) throw new Error('Not enough flag quiz options.');
  return shuffle(choices, random).map((country) => ({ leagueId: country.leagueId, name: country.leagueName }));
}
