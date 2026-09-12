import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface CompanyDoc {
  path: string;
  fingerprint: string;
  text: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'do', 'does', 'for', 'from', 'had',
  'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'make', 'may', 'me', 'more', 'must', 'no',
  'not', 'of', 'on', 'only', 'or', 'our', 'should', 'so', 'some', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'too', 'use', 'used', 'using', 'very', 'was', 'we', 'were', 'what', 'when',
  'which', 'will', 'with', 'would', 'you', 'your',
]);

const MAX_EXCERPT = 400;

/** Light stemming so "filter" matches "filters" without pulling in a stemming dependency. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [])
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
}

const isProse = (paragraph: string): boolean => !paragraph.startsWith('#') && !paragraph.startsWith('>');

/** Loaded once at boot. Markdown paragraphs only — no vector index, no whole-repo ingestion. */
export function loadCompanyDocs(dir: string): CompanyDoc[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  } catch {
    return [];
  }
  // Label paths as <parent>/<dir>/<file> so they read like workspace-relative references.
  const prefix = join(basename(dirname(dir)), basename(dir));
  return names.flatMap((name) => {
    const contents = readFileSync(join(dir, name), 'utf8');
    const fingerprint = createHash('sha256').update(contents).digest('hex').slice(0, 16);
    return contents
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim().replace(/\s+/g, ' '))
      .filter((paragraph) => paragraph.length > 0 && isProse(paragraph))
      .map((text) => ({ path: join(prefix, name), fingerprint, text }));
  });
}

export function retrieveCompanyNotes(
  docs: readonly CompanyDoc[],
  query: string,
  limit: number,
): Array<{ path: string; excerpt: string }> {
  if (limit <= 0) return [];
  const wanted = new Set(tokenize(query));
  if (wanted.size === 0) return [];
  return docs
    .map((doc) => {
      const tokens = tokenize(doc.text);
      const overlap = tokens.filter((token) => wanted.has(token)).length;
      return { doc, score: overlap === 0 ? 0 : overlap / Math.sqrt(tokens.length) };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => ({ path: scored.doc.path, excerpt: scored.doc.text.slice(0, MAX_EXCERPT) }));
}
