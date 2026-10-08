import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

function locationPath(response: Response) {
  const location = response.headers.get('location');
  assert.ok(location, 'expected a redirect location');
  return new URL(location, 'https://ht-120min.test').pathname;
}

test('defaults to English regardless of browser language or a legacy locale cookie', () => {
  const response = proxy(
    new NextRequest('https://ht-120min.test/', {
      headers: {
        'accept-language': 'lv-LV,lv;q=0.9,en;q=0.8',
        cookie: 'ht120_locale=lv',
      },
    }),
  );

  assert.equal(response.status, 307);
  assert.equal(locationPath(response), '/en');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('uses the explicitly selected locale for unprefixed paths', () => {
  const response = proxy(
    new NextRequest('https://ht-120min.test/create?step=teams', {
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'ht120_locale=lv; ht120_locale_choice=lv',
      },
    }),
  );

  assert.equal(response.status, 307);
  assert.equal(locationPath(response), '/lv/create');
  assert.equal(new URL(response.headers.get('location')!).search, '?step=teams');
});

test('disables the Forge testing shortcut unless Forge is explicitly enabled', () => {
  const response = proxy(new NextRequest('https://ht-120min.test/testing'));

  assert.equal(response.status, 404);
});
