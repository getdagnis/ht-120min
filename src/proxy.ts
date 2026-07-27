import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, isLocale } from './i18n/config';

const legacyPublicPaths = ['/create', '/matchmaker', '/tinder', '/supporters', '/auth/callback'];

function hasLocale(pathname: string) {
  const firstSegment = pathname.split('/')[1];
  return Boolean(firstSegment && isLocale(firstSegment));
}

function preferredLocale(request: NextRequest) {
  const cookieLocale = request.cookies.get('ht120_locale')?.value;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const acceptedLanguages = request.headers.get('accept-language')?.toLowerCase() || '';
  if (acceptedLanguages.split(',').some((language) => language.trim().startsWith('lv'))) return 'lv';
  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/forge')) {
    return NextResponse.next();
  }

  if (pathname === '/testing') {
    const target = request.nextUrl.clone();
    target.pathname = '/forge/testing';
    return NextResponse.redirect(target, 308);
  }

  if (hasLocale(pathname)) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = `/${preferredLocale(request)}${pathname === '/' ? '' : pathname}`;

  if (legacyPublicPaths.includes(pathname) || pathname === '/' || pathname.startsWith('/t/')) {
    return NextResponse.redirect(target, 308);
  }

  return NextResponse.redirect(target, 307);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
