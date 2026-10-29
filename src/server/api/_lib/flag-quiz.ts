import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FLAG_QUIZ_COUNTRIES, flagQuizOptions, type FlagQuizState } from '../../../../shared/flag-quiz.js';
import { getAppSessionSecret, verifyAppSessionCookie } from './app-session.js';
import { getServiceSupabase } from './supabase.js';

const random = () => randomInt(0x100000000) / 0x100000000;

export async function handleFlagQuiz(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (req.method === 'POST' && !session) return res.status(401).json({ error: 'Sign in to answer.', code: 'LOGIN_REQUIRED' });
  const db = getServiceSupabase();
  if (req.method === 'POST') {
    const { questionId, selectedLeagueId } = req.body ?? {};
    if (typeof questionId !== 'string' || !Number.isFinite(Date.parse(questionId)) ||
      !Number.isSafeInteger(selectedLeagueId) || selectedLeagueId < 1) {
      return res.status(400).json({ error: 'Invalid answer.', code: 'INVALID_ANSWER' });
    }
    const { error } = await db.rpc('answer_flag_quiz', {
      p_question_id: new Date(questionId).toISOString(), p_manager_id: session!.userId, p_selected_league_id: selectedLeagueId,
    });
    if (error) {
      if (error.code === 'P0002') return res.status(409).json({ error: 'Question expired.', code: 'QUESTION_EXPIRED' });
      if (error.code === '22023') return res.status(400).json({ error: 'Invalid answer.', code: 'INVALID_ANSWER' });
      throw new Error('Could not save flag quiz answer.');
    }
  }

  // Two different candidates suffice to avoid repeating the preceding flag.
  const first = randomInt(FLAG_QUIZ_COUNTRIES.length);
  const second = (first + 1 + randomInt(FLAG_QUIZ_COUNTRIES.length - 1)) % FLAG_QUIZ_COUNTRIES.length;
  const candidates = [first, second].map((index) => {
    const country = FLAG_QUIZ_COUNTRIES[index];
    return { correctLeagueId: country.leagueId, emoji: country.emoji, options: flagQuizOptions(country.leagueId, random) };
  });
  const { data: questionData, error: questionError } = await db.rpc('ensure_flag_quiz_question', { p_candidates: candidates });
  const question = Array.isArray(questionData) ? questionData[0] : questionData;
  if (questionError || !question) throw new Error('Could not load flag quiz.');
  const { data: state, error: stateError } = await db.rpc('flag_quiz_state', {
    p_question_id: question.starts_at, p_manager_id: session?.userId ?? null,
  });
  if (stateError || !state) throw new Error('Could not load flag quiz results.');
  const payload: FlagQuizState = {
    question: { id: question.starts_at, expiresAt: question.expires_at, emoji: question.emoji, options: question.options },
    canAnswer: Boolean(session), answer: state.answer, results: state.results, leaderboards: state.leaderboards,
  };
  return res.status(200).json(payload);
}
