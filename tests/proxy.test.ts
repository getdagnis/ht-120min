import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

function locationPath(response: Response) {
  const location = response.headers.get('location');
  assert.ok(location, 'expected a redirect location');
  return new URL(location, 'https://ht-120min.test').pathname;
}

test('redirects the root request to the default locale', () => {
  const response = proxy(new NextRequest('https://ht-120min.test/'));

  assert.equal(response.status, 308);
  assert.equal(locationPath(response), '/en');
});

test('uses the browser language for the initial locale redirect', () => {
  const response = proxy(
    new NextRequest('https://ht-120min.test/create', { headers: { 'accept-language': 'lv-LV,lv;q=0.9,en;q=0.8' } }),
  );

  assert.equal(response.status, 308);
  assert.equal(locationPath(response), '/lv/create');
});

test('keeps the legacy testing shortcut outside the localized public app', () => {
  const response = proxy(new NextRequest('https://ht-120min.test/testing'));

  assert.equal(response.status, 308);
  assert.equal(locationPath(response), '/forge/testing');
});
