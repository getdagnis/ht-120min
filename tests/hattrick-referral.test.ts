import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHattrickReferral } from '../src/utils/hattrick-referral.ts';

test('Hattrick referral detection accepts real subdomains and rejects lookalikes', () => {
  assert.equal(isHattrickReferral('https://stage.hattrick.org/Forum/Read.aspx?t=17699364'), true);
  assert.equal(isHattrickReferral('https://www82.hattrick.org/Forum/Read.aspx?t=17699364'), true);
  assert.equal(isHattrickReferral('https://chpp.hattrick.org/oauth/authorize.aspx'), true);
  assert.equal(isHattrickReferral('https://hattrick.org/'), false);
  assert.equal(isHattrickReferral('https://stage.hattrick.org.evil.test/'), false);
  assert.equal(isHattrickReferral('https://not-hattrick.org/'), false);
  assert.equal(isHattrickReferral('javascript:alert(1)'), false);
  assert.equal(isHattrickReferral(''), false);
});
