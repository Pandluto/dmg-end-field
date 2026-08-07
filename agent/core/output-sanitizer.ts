const INTERNAL_MARKUP_PATTERN = /<\s*[｜|]*\s*DSML|<\/?\s*(?:tool_calls?|function_calls?|invoke|parameter)\b|<!doctype\s+html|<\s*(?:html|head|body|script)\b/iu;

const INTERNAL_MARKUP_PREFIXES = [
  '<dsml',
  '<|dsml',
  '<tool_call',
  '</tool_call',
  '<function_call',
  '</function_call',
  '<invoke',
  '</invoke',
  '<parameter',
  '</parameter',
  '<!doctypehtml',
  '<html',
  '</html',
  '<head',
  '</head',
  '<body',
  '</body',
  '<script',
  '</script',
] as const;

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

export type AgentStreamingTextPartition = {
  readonly safe: string;
  readonly pending: string;
  readonly internalMarkupStarted: boolean;
};

/**
 * Split an assistant text stream before it reaches a renderer.
 *
 * A completed-text sanitizer cannot retract bytes that the native OpenCode UI
 * has already painted. Keep only a possible trailing markup prefix (normally a
 * lone `<` or a split DSML tag) until the next delta proves whether it is user
 * text or private serialization. Once a private marker is complete, callers
 * must suppress the remainder of that text part.
 */
export function partitionAgentStreamingText(text: string): AgentStreamingTextPartition {
  const match = INTERNAL_MARKUP_PATTERN.exec(text);
  if (match?.index !== undefined) {
    return {
      safe: text.slice(0, match.index),
      pending: '',
      internalMarkupStarted: true,
    };
  }

  const possibleStart = text.lastIndexOf('<');
  if (possibleStart < 0) {
    return { safe: text, pending: '', internalMarkupStarted: false };
  }
  const suffix = text.slice(possibleStart);
  if (!couldBecomeInternalMarkup(suffix)) {
    return { safe: text, pending: '', internalMarkupStarted: false };
  }
  return {
    safe: text.slice(0, possibleStart),
    pending: suffix,
    internalMarkupStarted: false,
  };
}

function couldBecomeInternalMarkup(value: string): boolean {
  const canonical = value
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, '')
    .replace(/｜/gu, '|')
    .replace(/\|+/gu, '|');
  return INTERNAL_MARKUP_PREFIXES.some((prefix) => (
    prefix.startsWith(canonical) || canonical.startsWith(prefix)
  ));
}
