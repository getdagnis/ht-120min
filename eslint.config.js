import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
    globalIgnores(['dist', '.next']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.next,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-globals': ['error', { name: 'alert', message: 'Use the app NoticeDialog instead of browser alerts.' }],
      'no-restricted-properties': ['error', { object: 'window', property: 'alert', message: 'Use the app NoticeDialog instead of browser alerts.' }],
    },
  },
])
