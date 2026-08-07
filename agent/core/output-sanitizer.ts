const INTERNAL_MARKUP_PATTERN = /<\s*[｜|]*\s*DSML|<\/?\s*(?:tool_calls?|function_calls?|invoke|parameter)\b|<!doctype\s+html|<\s*(?:html|head|body|script)\b/iu;

export const AGENT_UNREADABLE_OUTPUT_FALLBACK = '这次没有形成可读的业务结论，请重新说一次你的目标。' as const;

/**
 * Keep private tool-call serialization out of the user transcript.
 *
 * An engine may occasionally spell a DSML/XML tool request after the Harness
 * has already moved to a no-tool terminal phase. That text is an
 * implementation detail, not a user-visible answer. Keeping this sanitizer in
 * core also lets both an engine adapter and its transcript gateway apply the
 * same boundary without coupling Host back to a particular engine.
 */
export function sanitizeAgentCompletedText(text: string): string {
  if (!INTERNAL_MARKUP_PATTERN.test(String(text || ''))) return text;
  const cleaned = String(text || '')
    .replace(/<\s*[｜|]*\s*DSML[\s\S]*?<\/\s*[｜|]*\s*DSML\s*[｜|]*\s*(?:tool_calls?|function_calls?)\s*>/giu, '')
    .replace(/<\/?\s*[｜|]*\s*DSML[^>]*>/giu, '')
    .replace(/<\/?\s*(?:tool_calls?|function_calls?|invoke|parameter)\b[^>]*>/giu, '')
    .replace(/<!doctype\s+html[\s\S]*$/giu, '')
    .replace(/<\s*(?:html|head|body|script)\b[\s\S]*$/giu, '')
    .trim();
  return cleaned || AGENT_UNREADABLE_OUTPUT_FALLBACK;
}
