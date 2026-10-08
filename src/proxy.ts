import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, isLocale } from './i18n/config';

function hasLocale(pathname: string) {
  const firstSegment = pathname.split('/')[1];
  return Boolean(firstSegment && isLocale(firstSegment));
}

function preferredLocale(request: NextRequest) {
  const explicitLocale = request.cookies.get('ht120_locale_choice')?.value;
  return explicitLocale && isLocale(explicitLocale) ? explicitLocale : defaultLocale;
}

function localeRedirect(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = `/${preferredLocale(request)}${target.pathname === '/' ? '' : target.pathname}`;
  const response = NextResponse.redirect(target, 307);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/forge')) {
    return NextResponse.next();
  }

  if (pathname === '/testing') {
    if (process.env.FORGE_ENABLED !== 'true') return new NextResponse(null, { status: 404 });
    const target = request.nextUrl.clone();
    target.pathname = '/forge/testing';
    return NextResponse.redirect(target, 308);
  }

  if (hasLocale(pathname)) return NextResponse.next();

  return localeRedirect(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
