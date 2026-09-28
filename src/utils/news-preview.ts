export interface NewsArticlePreview {
  title: string | null;
  content: string;
  truncated: boolean;
}

const PREVIEW_THRESHOLD = 900;

const NEWS_EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

function stripNewsEmojis(value: string) {
  return value
    .replace(NEWS_EMOJI_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildNewsArticlePreview(input: { title?: string | null; content: string }): NewsArticlePreview {
  const title = stripNewsEmojis(input.title || '') || null;
  const content = stripNewsEmojis(input.content);

  if (content.length <= PREVIEW_THRESHOLD) {
    return { title, content, truncated: false };
  }

  const paragraphs = content.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const targetLength = Math.max(PREVIEW_THRESHOLD / 2, Math.round(content.length / 2));
  const selected: string[] = [];
  let selectedLength = 0;

  for (const paragraph of paragraphs) {
    const nextLength = selectedLength + paragraph.length + (selected.length > 0 ? 2 : 0);
    if (selected.length > 0 && nextLength > targetLength) break;
    selected.push(paragraph);
    selectedLength = nextLength;
  }

  const previewContent = selected.join('\n\n') || content;
  return {
    title,
    content: previewContent,
    truncated: previewContent.length < content.length,
  };
}
