import type { RoundPressInput } from './round-press-input.js';
import { CLOUDFLARE_ROUND_PRESS_MODEL, generateCloudflareRoundPressDraft } from './round-press-cloudflare-writer.js';
import { generateRoundPressDraft, ROUND_PRESS_MODEL } from './round-press-writer.js';
import type { RoundPressDraft } from './round-press-validator.js';

export type RoundPressProvider = 'gemini' | 'cloudflare';

export class RoundPressProviderConfigurationError extends Error {
  constructor() {
    super('Round press provider configuration is invalid.');
    this.name = 'RoundPressProviderConfigurationError';
  }
}

export function resolveRoundPressProvider(value = process.env.ROUND_PRESS_PROVIDER): RoundPressProvider {
  const provider = value?.trim().toLowerCase() || 'gemini';
  if (provider === 'gemini' || provider === 'cloudflare') return provider;
  throw new RoundPressProviderConfigurationError();
}

export function roundPressModelForProvider(provider: RoundPressProvider) {
  return provider === 'cloudflare' ? CLOUDFLARE_ROUND_PRESS_MODEL : ROUND_PRESS_MODEL;
}

type RoundPressGeneration = { draft: RoundPressDraft; repaired: boolean };

export interface ConfiguredRoundPressWriterDependencies {
  providerValue?: string;
  generateGemini?: (input: RoundPressInput) => Promise<RoundPressGeneration>;
  generateCloudflare?: (input: RoundPressInput) => Promise<RoundPressGeneration>;
}

export async function generateConfiguredRoundPressDraft(
  input: RoundPressInput,
  dependencies: ConfiguredRoundPressWriterDependencies = {},
): Promise<RoundPressGeneration & { provider: RoundPressProvider; model: string }> {
  const provider = resolveRoundPressProvider(dependencies.providerValue);
  const result = provider === 'cloudflare'
    ? await (dependencies.generateCloudflare ?? generateCloudflareRoundPressDraft)(input)
    : await (dependencies.generateGemini ?? generateRoundPressDraft)(input);
  return {
    ...result,
    provider,
    model: roundPressModelForProvider(provider),
  };
}
