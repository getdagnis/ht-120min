export const NEWS_COMMENT_MAX_LENGTH = 480;

export function validateNewsComment(comment: unknown) {
  const preserved = typeof comment === 'string' ? comment : '';
  if (preserved.trim().length < 1 || preserved.length > NEWS_COMMENT_MAX_LENGTH) {
    return { comment: '', error: `Comment must be between 1 and ${NEWS_COMMENT_MAX_LENGTH} characters.` };
  }
  return { comment: preserved, error: null };
}
