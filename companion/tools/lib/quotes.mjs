// Finds a verbatim quote in the extracted PDS pages so every card can cite a page number.
// Matching ignores case, whitespace, curly-vs-straight quotes and dash style, nothing else.
import { readFileSync } from 'node:fs';

export function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/-\s+/g, '-')        // words hyphenated across a line break
    .replace(/\s+-/g, '-')
    .trim();
}

export function loadPages(root) {
  const pages = JSON.parse(readFileSync(new URL('data/pages.json', root), 'utf8'));
  // Supplementary ATO excerpts are treated as one "page" each (page 0: no PDF page to cite).
  const ato = JSON.parse(readFileSync(new URL('data/ato-excerpts.json', root), 'utf8'));
  for (const a of ato.pages) pages.push({ doc: a.id, page: 0, text: a.excerpts.join('\n') });
  // UniSuper website excerpts work the same way.
  const web = JSON.parse(readFileSync(new URL('data/web-excerpts.json', root), 'utf8'));
  for (const w of web.pages) pages.push({ doc: w.id, page: 0, text: w.excerpts.join('\n') });
  return pages.map((p) => ({ ...p, norm: normalise(p.text) }));
}

// Returns the first PDF page (1-based) in `doc` that contains `quote`, or null.
export function locate(pages, doc, quote) {
  const q = normalise(quote);
  const hit = pages.find((p) => p.doc === doc && p.norm.includes(q));
  return hit ? hit.page : null;
}
