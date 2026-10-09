import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { englishCatalog, keysForSection, type CatalogSection, type CatalogValues } from './catalog.js';

function messageSignature(elements: MessageFormatElement[]) {
  const variables = new Set<string>();
  const tags = new Set<string>();
  function visit(items: MessageFormatElement[]) {
    for (const item of items) {
      if (item.type === TYPE.tag) {
        tags.add(item.value);
        visit(item.children);
      } else if (item.type === TYPE.plural || item.type === TYPE.select) {
        variables.add(item.value);
        for (const option of Object.values(item.options)) visit(option.value);
      } else if (item.type !== TYPE.literal && item.type !== TYPE.pound) {
        variables.add(item.value);
      }
    }
  }
  visit(elements);
  return { variables: [...variables].sort().join(','), tags: [...tags].sort().join(',') };
}

export function isValidCatalogMessage(key: string, value: string) {
  if (typeof value !== 'string' || value.length > 12000 || !(key in englishCatalog)) return false;
  if (!value.trim()) return true;
  // FAQ markdown links render as anchors; only local and HTTP(S) destinations are allowed.
  if (/\]\((?!https?:\/\/|\/|#)[^)]+\)/i.test(value)) return false;
  try {
    const english = messageSignature(parse(englishCatalog[key]));
    const translated = messageSignature(parse(value));
    return english.variables === translated.variables && english.tags === translated.tags;
  } catch { return false; }
}

export function validateCatalogValues(value: unknown, section: CatalogSection): CatalogValues | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = keysForSection(section);
  const entries = Object.entries(value);
  if (entries.length > keys.length || JSON.stringify(value).length > 250000) return null;
  if (entries.some(([key, text]) => !keys.includes(key) || typeof text !== 'string' || !isValidCatalogMessage(key, text))) {
    return null;
  }
  return value as CatalogValues;
}
