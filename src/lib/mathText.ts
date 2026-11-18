/** A run of title text, either plain or LaTeX math. */
export interface MathSegment {
  math: boolean;
  text: string;
}

// $$..$$, $..$, \(..\) and \chem{..} (publisher markup for formulas).
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\chem\{((?:[^{}]|\{[^{}]*\})*)\}/g;

/**
 * A lone `$...$` is also how prices appear ("$49.95 ... $12.00"), so only accept
 * it when the content reads as math: short, and either LaTeX-looking or a few
 * plain symbols such as `$N$`, `$g-2$` or `$J/ψ$`.
 */
function looksLikeMath(inner: string): boolean {
  if (inner.length > (inner.includes("\\") ? 200 : 80)) return false;
  if (/[\\^_{}]/.test(inner)) return true;
  if (/\P{ASCII}/u.test(inner) && !/\d\.\d\d\b/.test(inner)) return true; // Greek letters, arrows, ± ...
  return /^[^\s$]{1,3}$|^[\p{L}\p{N}\s\-+=.,/()'’]{1,14}$/u.test(inner.trim()) && !/\d\.\d\d\b/.test(inner);
}

export function splitMath(text: string): MathSegment[] {
  if (!text.includes("$") && !text.includes("\\")) return [{ math: false, text }];
  const out: MathSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_RE)) {
    const [whole, display, inline, paren, chem] = m;
    const tex = display ?? paren ?? chem ?? inline;
    // only the bare $..$ form is ambiguous; delimited forms are always math
    if (inline !== undefined && display === undefined && !looksLikeMath(inline)) continue;
    const start = m.index ?? 0;
    if (start > last) out.push({ math: false, text: text.slice(last, start) });
    out.push({ math: true, text: tex.trim() });
    last = start + whole.length;
  }
  if (last < text.length) out.push({ math: false, text: text.slice(last) });
  return out.length ? out : [{ math: false, text }];
}
