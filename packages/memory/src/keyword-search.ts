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

// A term matches only as a whole word: any adjacent character must be non-alphanumeric, so
// "atlas" hits "atlas" and "atlas-rebrand" but never "catalyst" or "Atlases".
function wordMatchIndexes(haystack: string, term: string): number[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("(?<![\\p{L}\\p{N}])" + escaped + "(?![\\p{L}\\p{N}])", "gu");
  const indexes: number[] = [];
  for (const match of haystack.matchAll(pattern)) indexes.push(match.index!);
  return indexes;
}

export function memorySearchTermHits(content: string, path: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const haystack = (content + "\n" + path).toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (wordMatchIndexes(haystack, term).length > 0) hits += 1;
  }
  return hits;
}

export function memorySearchSnippet(content: string, terms: readonly string[]): string {
  const lower = content.toLowerCase();
  const positions: number[] = [];
  for (const term of terms) {
    for (const index of wordMatchIndexes(lower, term)) positions.push(index);
  }
  if (positions.length === 0) return content.slice(0, 140);
  // Center the snippet where the query terms cluster most densely, not at the first term's first hit.
  let best = positions[0]!;
  let bestDensity = -1;
  for (const position of positions) {
    let density = 0;
    for (const index of positions) {
      if (index >= position - 40 && index <= position + 80) density += 1;
    }
    if (density > bestDensity) {
      bestDensity = density;
      best = position;
    }
  }
  return content.slice(Math.max(0, best - 40), best + 120);
}
