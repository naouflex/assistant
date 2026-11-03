const TERM_PATTERN = /[\p{L}\p{N}]+/gu;
export const KEYWORD_SEARCH_MAX_TERMS = 12;

export function memorySearchTerms(query: string, maxTerms = KEYWORD_SEARCH_MAX_TERMS): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(TERM_PATTERN)) {
    const term = match[0]!;
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

export function memorySearchTermHits(content: string, path: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const haystack = `${content}\n${path}`.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1;
  }
  return hits;
}

export function memorySearchSnippet(content: string, terms: readonly string[]): string {
  const lower = content.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) return content.slice(Math.max(0, idx - 40), idx + term.length + 80);
  }
  return content.slice(0, 140);
}
