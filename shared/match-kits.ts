export function toLargeMatchKitUrl(url: string): string {
  return url.replace(/matchKit(?:Small|large)\.png(?=$|[?#])/, 'matchKitLarge.png');
}
