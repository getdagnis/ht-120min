import { Barlow, Barlow_Condensed, IBM_Plex_Mono, Noto_Color_Emoji } from 'next/font/google';

export const barlow = Barlow({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-barlow',
});

export const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-barlow-condensed',
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
});

export const notoColorEmoji = Noto_Color_Emoji({
  subsets: ['emoji'],
  weight: '400',
  display: 'swap',
  variable: '--font-noto-color-emoji',
});
