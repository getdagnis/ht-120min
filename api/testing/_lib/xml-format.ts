function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function beautifyXml(xml: string): string {
  const compact = xml.trim().replace(/>\s+</g, '><');
  if (!compact) return '';

  const lines: string[] = [];
  let indent = 0;
  const tokens = compact.split(/(?=<)/).filter(Boolean);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const isClosing = /^<\//.test(trimmed);
    const isSelfClosing = /\/>$/.test(trimmed) || /^<\?/.test(trimmed) || /^<!/.test(trimmed);
    const isOpening = /^<[^!?/][^>]*>$/.test(trimmed) && !isSelfClosing;

    if (isClosing) {
      indent = Math.max(0, indent - 1);
    }

    lines.push(`${'  '.repeat(indent)}${trimmed}`);

    if (isOpening) {
      indent += 1;
    }
  }

  return lines.join('\n');
}

export function renderTestingHtmlPage(input: {
  title: string;
  subtitle?: string;
  parsed?: Record<string, unknown> | null;
  rawXml?: string;
  backHref?: string;
}): string {
  const formattedXml = input.rawXml ? beautifyXml(input.rawXml) : '';
  const parsedBlock =
    input.parsed && Object.keys(input.parsed).length > 0
      ? `<pre class="parsed">${escapeHtml(JSON.stringify(input.parsed, null, 2))}</pre>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 1.5rem; line-height: 1.45; color: #1a1a1a; }
    h1 { font-size: 1.1rem; margin: 0 0 0.35rem; }
    p { margin: 0.35rem 0; color: #555; }
    a { color: #0b57d0; }
    pre { background: #f7f7f8; border: 1px solid #e3e3e8; border-radius: 8px; padding: 1rem; overflow: auto; font-size: 0.85rem; }
    pre.xml { white-space: pre-wrap; word-break: break-word; }
    .parsed { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <p><a href="${escapeHtml(input.backHref || '/testing')}">← Back to testing hub</a></p>
  <h1>${escapeHtml(input.title)}</h1>
  ${input.subtitle ? `<p>${escapeHtml(input.subtitle)}</p>` : ''}
  ${parsedBlock}
  ${formattedXml ? `<pre class="xml">${escapeHtml(formattedXml)}</pre>` : ''}
</body>
</html>`;
}
