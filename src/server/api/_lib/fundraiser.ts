import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  emptyFundraiserProducts, FUNDRAISER_PRODUCTS, FUNDRAISER_STATUS, fundraiserProduct,
  type FundraiserState,
} from '../../../../shared/fundraiser.js';
import { getAppSessionSecret, verifyAppSessionCookie } from './app-session.js';
import { getServiceSupabase } from './supabase.js';

const CLICK_MAX_AGE_SECONDS = 60 * 60;

function clickCookieName(key: string): string {
  return `ht120_fundraiser_click_${key}`;
}

function clickCookie(key: string, value: string, maxAge: number): string {
  return `${clickCookieName(key)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

function signedClick(managerId: number, item: string, secret: string): string {
  const encoded = Buffer.from(JSON.stringify({ managerId, item, expiresAt: Date.now() + CLICK_MAX_AGE_SECONDS * 1000 }))
    .toString('base64url');
  const signature = createHmac('sha256', secret).update(`fundraiser-click:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

export function clickedByManager(cookieHeader: string | undefined, item: string, managerId: number, secret: string): boolean {
  const value = cookieHeader?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${clickCookieName(item)}=`))?.slice(clickCookieName(item).length + 1);
  if (!value) return false;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature || encoded.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`fundraiser-click:${encoded}`).digest('base64url');
  if (expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const click = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
      managerId?: unknown; item?: unknown; expiresAt?: unknown;
    };
    return click.managerId === managerId && click.item === item &&
      typeof click.expiresAt === 'number' && click.expiresAt >= Date.now();
  } catch { return false; }
}

function signedInManager(req: VercelRequest): number | null {
  const secret = getAppSessionSecret();
  return secret ? verifyAppSessionCookie(req.headers.cookie, secret)?.userId ?? null : null;
}

async function loadState(managerId: number | null): Promise<FundraiserState> {
  const db = getServiceSupabase();
  const { data, error } = await db.rpc('next_season_fundraiser_summary');
  if (error) throw new Error('Fundraiser totals are unavailable.');
  let hasSupported = false;
  if (managerId) {
    const { data: purchase, error: purchaseError } = await db.from('next_season_bmc_payments')
      .select('payment_id').eq('claimed_manager_id', managerId).eq('refunded', false).limit(1);
    if (purchaseError) throw new Error('Support status is unavailable.');
    hasSupported = Boolean(purchase?.length);
  }
  const products = emptyFundraiserProducts();
  for (const row of data ?? []) {
    const product = FUNDRAISER_PRODUCTS.find(({ itemId }) => itemId === Number(row.item_id));
    if (!product) continue;
    products[product.key] = {
      quantity: Number(row.quantity) || 0,
      euroCents: Number(row.euro_cents) || 0,
      supporters: Array.isArray(row.supporters)
        ? row.supporters.filter((name: unknown): name is string => typeof name === 'string').slice(0, 20)
        : [],
    };
  }
  const beers = FUNDRAISER_PRODUCTS.reduce((sum, product) =>
    sum + products[product.key].quantity * product.beers, 0);
  return { status: FUNDRAISER_STATUS, beers, hasSupported, products };
}

export async function handleFundraiser(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (FUNDRAISER_STATUS === 'hidden') return res.status(404).json({ error: 'Fundraiser unavailable.' });
  return res.status(200).json(await loadState(signedInManager(req)));
}

export function handleFundraiserCheckout(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const product = typeof req.query?.item === 'string' ? fundraiserProduct(req.query.item) : undefined;
  if (!product || FUNDRAISER_STATUS !== 'active') return res.status(404).json({ error: 'Fundraiser unavailable.' });
  const managerId = signedInManager(req);
  const secret = getAppSessionSecret();
  res.setHeader('Set-Cookie', managerId && secret
    ? clickCookie(product.key, signedClick(managerId, product.key, secret), CLICK_MAX_AGE_SECONDS)
    : clickCookie(product.key, '', 0));
  return res.redirect(303, product.url);
}

export async function handleFundraiserClaim(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const managerId = signedInManager(req);
  if (!managerId) return res.status(401).json({ error: 'Sign in to view your thank-you.' });
  const product = typeof req.body?.item === 'string' ? fundraiserProduct(req.body.item) : undefined;
  if (!product) return res.status(400).json({ error: 'Unknown product.' });
  const secret = getAppSessionSecret();
  if (!secret || !clickedByManager(req.headers.cookie, product.key, managerId, secret)) {
    return res.status(200).json({ matched: false });
  }
  const db = getServiceSupabase();
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('manager_name').eq('hattrick_user_id', managerId).maybeSingle();
  if (profileError) throw new Error('Manager profile is unavailable.');
  const managerName = typeof profile?.manager_name === 'string' ? profile.manager_name.trim() : '';
  if (!managerName || managerName.length > 60) return res.status(200).json({ matched: false });
  const { data, error } = await db.rpc('claim_next_season_bmc_order', {
    p_item_id: product.itemId, p_manager_id: managerId, p_manager_name: managerName,
  });
  if (error) throw new Error('Could not match Shop purchase.');
  res.setHeader('Set-Cookie', clickCookie(product.key, '', 0));
  return res.status(200).json({ matched: data === true, managerName: data === true ? managerName : undefined });
}

export function verifyBmcSignature(rawBody: string, secret: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

type BmcEnvelope = {
  type?: unknown;
  live_mode?: unknown;
  created?: unknown;
  data?: Record<string, unknown>;
};

function asEuroCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(cents / 100 - value) < 0.000001 ? cents : null;
}

export function parseBmcShopOrder(event: BmcEnvelope) {
  const data = event.data;
  const refunded = event.type === 'extra_purchase.refunded' ||
    (event.type === 'extra_purchase.updated' && data?.status === 'refunded' && data.refunded === 'true');
  const extras = refunded ? [] : Array.isArray(data?.extras) ? data.extras : data?.extras == null ? [] : null;
  if (!data || !Number.isSafeInteger(data.id) || Number(data.id) <= 0 || data.object !== 'payment' ||
    (data.support_type != null && data.support_type !== 'Extra') ||
    (data.amount != null && asEuroCents(data.amount) === null) ||
    (data.currency != null && (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency))) ||
    !Number.isSafeInteger(event.created) || Number(event.created) <= 0 ||
    !extras) return null;

  if (refunded ? data.status !== 'refunded' || data.refunded !== 'true'
    : data.status !== 'succeeded' || data.refunded !== 'false') return null;

  const items = new Map<number, { item_id: number; quantity: number; euro_cents: number }>();
  for (const raw of extras) {
    if (!raw || typeof raw !== 'object') return null;
    const extra = raw as Record<string, unknown>;
    const product = FUNDRAISER_PRODUCTS.find(({ itemId }) => itemId === extra.id);
    if (!product) continue;
    const euroCents = asEuroCents(extra.amount);
    if (extra.object !== 'extra' || (extra.currency ?? data.currency) !== 'EUR' || euroCents === null ||
      !Number.isSafeInteger(extra.quantity) || Number(extra.quantity) < 1 || Number(extra.quantity) > 1000 ||
      euroCents > 100_000_000) return null;
    const previous = items.get(product.itemId);
    if (previous && previous.euro_cents !== euroCents) return null;
    const quantity = (previous?.quantity ?? 0) + Number(extra.quantity);
    if (quantity > 1000) return null;
    items.set(product.itemId, { item_id: product.itemId, quantity, euro_cents: euroCents });
  }
  const createdAt = Number.isSafeInteger(data.created_at) && Number(data.created_at) > 0
    ? Number(data.created_at) : Number(event.created);
  if (createdAt > 8_640_000_000_000 || Number(event.created) > 8_640_000_000_000) return null;
  return {
    paymentId: Number(data.id), refunded,
    createdAt: new Date(createdAt * 1000).toISOString(),
    eventAt: new Date(Number(event.created) * 1000).toISOString(),
    items: [...items.values()],
  };
}

export async function handleBmcWebhook(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = process.env.BMC_WEBHOOK_SECRET;
  const rawBody = req.body;
  if (!secret) return res.status(503).json({ error: 'Webhook unavailable.' });
  if (typeof rawBody !== 'string' || !verifyBmcSignature(rawBody, secret, req.headers['x-signature-sha256'])) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }
  let event: BmcEnvelope;
  try { event = JSON.parse(rawBody) as BmcEnvelope; }
  catch { return res.status(400).json({ error: 'Invalid webhook.' }); }
  if (!event || typeof event !== 'object') return res.status(400).json({ error: 'Invalid webhook.' });
  if (event.live_mode === false || ![
    'extra_purchase.created', 'extra_purchase.updated', 'extra_purchase.refunded',
  ].includes(String(event.type))) return res.status(200).json({ ok: true });
  if (event.live_mode !== true) return res.status(400).json({ error: 'Invalid webhook.' });
  const order = parseBmcShopOrder(event);
  if (!order) return res.status(400).json({ error: 'Invalid Shop order.' });
  if (order.items.length === 0 && !order.refunded) return res.status(200).json({ ok: true });
  const { error } = await getServiceSupabase().rpc('record_next_season_bmc_order', {
    p_payment_id: order.paymentId,
    p_refunded: order.refunded,
    p_bmc_created_at: order.createdAt,
    p_event_at: order.eventAt,
    p_items: order.items,
  });
  if (error) throw new Error('Could not record Shop order.');
  return res.status(200).json({ ok: true });
}
