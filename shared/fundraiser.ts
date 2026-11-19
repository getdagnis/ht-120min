const configuredStatus = process.env.NEXT_PUBLIC_FUNDRAISER_STATUS;
export const FUNDRAISER_STATUS: 'active' | 'closed' | 'hidden' =
  configuredStatus === 'closed' || configuredStatus === 'hidden' ? configuredStatus : 'active';

export const FUNDRAISER_PRODUCTS = [
  { key: 'hfi', itemId: 599984, url: 'https://buymeacoffee.com/dagnis/e/599984', beers: 1, price: 5, badge: '/alus/badge-exotic.png' },
  { key: 'flags', itemId: 599987, url: 'https://buymeacoffee.com/dagnis/e/599987', beers: 1, price: 5, badge: '/alus/badge-flags.png' },
  { key: '120min', itemId: 599986, url: 'https://buymeacoffee.com/dagnis/e/599986', beers: 1, price: 5, badge: '/alus/badge-120.png' },
  { key: 'general', itemId: 599982, url: 'https://buymeacoffee.com/dagnis/e/599982', beers: 2, price: 10, badge: '/alus/badge-120-beer.png' },
] as const;

export type FundraiserProductKey = (typeof FUNDRAISER_PRODUCTS)[number]['key'];
export const FUNDRAISER_SESSION_PROMPT_KEY = 'ht120_fundraiser_prompt_session_v1';

export interface FundraiserState {
  status: typeof FUNDRAISER_STATUS;
  beers: number;
  hasSupported: boolean;
  products: Record<FundraiserProductKey, { quantity: number; euroCents: number; supporters: string[] }>;
}

export function emptyFundraiserProducts(): FundraiserState['products'] {
  const emptyProduct = (): FundraiserState['products']['hfi'] => ({
    quantity: 0, euroCents: 0, supporters: [],
  });
  return {
    hfi: emptyProduct(),
    flags: emptyProduct(),
    '120min': emptyProduct(),
    general: emptyProduct(),
  };
}

export function fundraiserProduct(key: string) {
  return FUNDRAISER_PRODUCTS.find((product) => product.key === key);
}
