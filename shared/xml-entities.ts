const XML_ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;

export function decodeXmlEntities(value: string): string {
  return value.replace(XML_ENTITY_PATTERN, (entity, reference: string) => {
    switch (reference.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const codePoint = reference.toLowerCase().startsWith('#x')
          ? Number.parseInt(reference.slice(2), 16)
          : Number.parseInt(reference.slice(1), 10);
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      }
    }
  });
}
