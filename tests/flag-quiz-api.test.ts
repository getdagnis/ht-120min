import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleFlagQuiz } from '../src/server/api/_lib/flag-quiz.ts';
import { buildAppSessionCookie } from '../src/server/api/_lib/app-session.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

function setup() {
  process.env.APP_SESSION_SECRET = 'quiz-test-secret';
  process.env.SUPABASE_URL = 'https://quiz.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  delete process.env.SUPABASE_SECRET_KEY;
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  let failure: string | null = null;
  globalThis.fetch = async (input, init) => {
    const name = String(input).split('/').at(-1)!;
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ name, body });
    if (name === 'answer_flag_quiz' && failure) return Response.json({ code: failure, message: 'Rejected' }, { status: 400 });
    if (name === 'ensure_flag_quiz_question') return Response.json({ starts_at: '2026-10-22T00:00:00Z', expires_at: '2026-10-22T12:00:00Z', emoji: '🇸🇪', correct_league_id: 1, options: [{ leagueId: 1, name: 'Sweden' }] });
    if (name === 'flag_quiz_state') return Response.json({ answer: null, results: null, leaders: [] });
    return Response.json(null);
  };
  const response = { statusCode: 200, payload: null as unknown, headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this.payload = data; return this; },
    setHeader(key: string, value: unknown) { this.headers[key] = value; return this; },
  };
  return { calls, response, fail: (code: string) => { failure = code; } };
}
function request(method: string, body?: unknown, signed = false) {
  return { method, body, headers: { cookie: signed ? buildAppSessionCookie(77, 'quiz-test-secret', false) : undefined } } as VercelRequest;
}

test('anonymous reads contain no correct-answer field or voter identities and cannot submit', async () => {
  const { calls, response } = setup();
  await handleFlagQuiz(request('GET'), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 200);
  assert.ok(!JSON.stringify(response.payload).includes('correct_league_id'));
  assert.equal((response.payload as { canAnswer: boolean }).canAnswer, false);
  assert.equal(calls.at(-1)?.body.p_manager_id, null);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  await handleFlagQuiz(request('POST', { questionId: '2026-10-22', selectedLeagueId: 1 }), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 2);
});

test('signed submission uses session identity and rejects malformed, expired, or invalid answers', async () => {
  const { calls, response, fail } = setup();
  const body = { questionId: '2026-10-22T00:00:00Z', selectedLeagueId: 1, managerId: 999 };
  await handleFlagQuiz(request('POST', body, true), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].body.p_manager_id, 77);
  fail('P0002');
  await handleFlagQuiz(request('POST', body, true), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 409);
  fail('22023');
  await handleFlagQuiz(request('POST', body, true), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 400);
  for (const invalid of [null, {}, { ...body, selectedLeagueId: '1' }, { ...body, questionId: 'bad' }]) {
    await handleFlagQuiz(request('POST', invalid, true), response as unknown as VercelResponse);
    assert.equal(response.statusCode, 400);
  }
});

test('unsupported methods do not touch quiz storage', async () => {
  const { calls, response } = setup();
  await handleFlagQuiz(request('DELETE'), response as unknown as VercelResponse);
  assert.equal(response.statusCode, 405);
  assert.equal(calls.length, 0);
});
