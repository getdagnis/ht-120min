import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOrganizerRound } from '../src/server/api/_lib/organizer-round.js';

test('unscored legacy context offers future slots without staged metadata or an open playoff', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://organizer-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test';
  let mode = 'single';
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'organizer-test.invalid');
    const table = url.pathname.split('/').at(-1);
    const data = table === 'tournaments' ? { season: 2, schedule_mode: mode, schedule_generated_at: '2026-09-17T00:00:00Z' }
      : table === 'get_organizer_round_context' ? { rosterVersion: 'version', teams: [{ id: 'team', country_name: 'Guam', league_level: 1 }],
        rounds: [{ id: 'old', round_number: 1, phase: 'postseason', phase_status: 'completed', reserved_slot_id: null, reserved_slot_date: null }], history: [] }
        : table === 'organizer_saved_repair_enabled' ? true : [];
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (mode of ['single', 'double', 'recurring']) {
      let status = 200;
      let body: { slots?: unknown[]; error?: string } = {};
      const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: typeof body) { body = value; return this; } } as unknown as VercelResponse;
      await handleOrganizerRound({ method: 'GET' } as VercelRequest, response, 'cup', true, 0, true);
      assert.equal(status, 200);
      assert.ok(body.slots?.length, 'Legacy unscored creation must offer future slots');
      await handleOrganizerRound({ method: 'GET' } as VercelRequest, response, 'cup', true, 0, false);
      assert.equal(status, 409, 'Counted legacy creation remains unsupported');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});
