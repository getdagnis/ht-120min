import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    NEXT_PUBLIC_MATCHMAKER_DEV_MODE: process.env.NEXT_PUBLIC_MATCHMAKER_DEV_MODE || '',
    NEXT_PUBLIC_MATCHMAKER_MOCK_DATA: process.env.NEXT_PUBLIC_MATCHMAKER_MOCK_DATA || '',
  },
  sassOptions: {
    silenceDeprecations: ['legacy-js-api'],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  turbopack: {
    rules: {
      '*.ts': { condition: { not: 'foreign' }, loaders: ['./scripts/dev/turbopack-ts-imports.cjs'] },
      '*.tsx': { condition: { not: 'foreign' }, loaders: ['./scripts/dev/turbopack-ts-imports.cjs'] },
    },
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
