import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveTheme } from '../src/utils/theme';

test('theme telemetry prefers the explicit stored preference', () => {
  assert.equal(resolveEffectiveTheme({ storedPreference: 'dark', dataTheme: 'light', prefersDark: false }), 'dark');
});

test('theme telemetry falls back to the rendered data theme', () => {
  assert.equal(resolveEffectiveTheme({ storedPreference: 'system', dataTheme: 'dark', prefersDark: false }), 'dark');
});

test('theme telemetry resolves system preference from the OS media query', () => {
  assert.equal(resolveEffectiveTheme({ storedPreference: 'system', dataTheme: null, prefersDark: true }), 'dark');
  assert.equal(resolveEffectiveTheme({ storedPreference: null, dataTheme: null, prefersDark: false }), 'light');
});
