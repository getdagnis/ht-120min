import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNewsArticlePreview } from '../src/utils/news-preview';

test('keeps short news complete while removing emojis from the preview', () => {
  const preview = buildNewsArticlePreview({
    title: 'A tournament story 🇸🇲',
    content: 'The story ends here. 💪',
  });

  assert.equal(preview.title, 'A tournament story');
  assert.equal(preview.content, 'The story ends here.');
  assert.equal(preview.truncated, false);
});

test('cuts long news at a paragraph boundary', () => {
  const firstParagraph = 'The first paragraph explains the background and gives managers the essential context. '.repeat(7).trim();
  const secondParagraph = 'The second paragraph adds further history and detail for readers who want the full story. '.repeat(7).trim();
  const preview = buildNewsArticlePreview({ content: `${firstParagraph}\n\n${secondParagraph}` });

  assert.equal(preview.truncated, true);
  assert.equal(preview.content, firstParagraph);
  assert.ok(!preview.content.includes('The second paragraph'));
});
