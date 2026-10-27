import React from 'react';

const TAG_PATTERN = /\[(\/)?(b|i|link)(?:=([^\]\s]+))?\]/gi;

type Node = { tag: 'b' | 'i' | 'a'; href?: string; children: React.ReactNode[] };

function safeChatUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function renderChatMarkup(content: string): React.ReactNode[] {
  const root: React.ReactNode[] = [];
  const stack: Array<{ node: Node; parent: React.ReactNode[] }> = [];
  let target = root;
  let cursor = 0;
  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;

  while ((match = TAG_PATTERN.exec(content))) {
    if (match.index > cursor) target.push(content.slice(cursor, match.index));
    const [, closing, rawTag, rawUrl] = match;
    const tag = rawTag.toLowerCase() as 'b' | 'i' | 'link';

    if (closing) {
      const openIndex = stack.map(({ node }) => node.tag).lastIndexOf(tag === 'link' ? 'a' : tag);
      if (openIndex >= 0) {
        const open = stack[openIndex];
        while (stack.length > openIndex) stack.pop();
        target = open.parent;
        target.push(React.createElement(open.node.tag, {
          key: `markup-${match.index}`,
          ...(open.node.tag === 'a' ? { href: open.node.href, target: '_blank', rel: 'noopener noreferrer' } : {}),
        }, ...open.node.children));
      } else target.push(match[0]);
    } else if (tag === 'link' && rawUrl) {
      const href = safeChatUrl(rawUrl);
      const closingTag = content.indexOf('[/link]', TAG_PATTERN.lastIndex);
      if (href && closingTag >= 0) {
        const parent = target;
        const node: Node = { tag: 'a', href, children: [] };
        stack.push({ node, parent });
        target = node.children;
      } else if (href) {
        target.push(React.createElement('a', { key: `markup-${match.index}`, href, target: '_blank', rel: 'noopener noreferrer' }, rawUrl));
      } else target.push(match[0]);
    } else if (tag !== 'link') {
      const parent = target;
      const node: Node = { tag, children: [] };
      stack.push({ node, parent });
      target = node.children;
    } else target.push(match[0]);
    cursor = TAG_PATTERN.lastIndex;
  }

  if (cursor < content.length) target.push(content.slice(cursor));
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    parent.push(React.createElement(node.tag, {
      key: `markup-end-${parent.length}`,
      ...(node.tag === 'a' ? { href: node.href, target: '_blank', rel: 'noopener noreferrer' } : {}),
    }, ...node.children));
  }
  return root;
}
