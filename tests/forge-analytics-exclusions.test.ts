import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExcludedAnalyticsReferrer,
  isVercelPreviewAnalyticsHost,
} from '../src/server/api/_lib/analytics.js';

test('generated project preview hosts are excluded without hiding the main site', () => {
  const preview = 'ht-120min-ln95vik6k-getdagnis-projects.vercel.app';
  assert.equal(isVercelPreviewAnalyticsHost(preview), true);
  assert.equal(isVercelPreviewAnalyticsHost(`HTTPS://${preview}`), false);
  assert.equal(isVercelPreviewAnalyticsHost('ht-120min.vercel.app'), false);
  assert.equal(isVercelPreviewAnalyticsHost('120min.vercel.app'), false);
  assert.equal(isVercelPreviewAnalyticsHost('ht-120min-ln95vik6k-getdagnis-projects.vercel.app.attacker.test'), false);
  assert.equal(isVercelPreviewAnalyticsHost('someone-else-getdagnis-projects.vercel.app'), false);
});

test('Forge excludes historical preview referrers and localhost traffic', () => {
  assert.equal(isExcludedAnalyticsReferrer('https://ht-120min-ln95vik6k-getdagnis-projects.vercel.app/en'), true);
  assert.equal(isExcludedAnalyticsReferrer('http://localhost:3000/en'), true);
  assert.equal(isExcludedAnalyticsReferrer('https://ht-120min.vercel.app/en'), false);
  assert.equal(isExcludedAnalyticsReferrer('https://other.example/en'), false);
  assert.equal(isExcludedAnalyticsReferrer(null), false);
});
