import { useEffect, useState } from "react";
import "./MathSpan.css";

// KaTeX and its stylesheet are fetched the first time a title with math is shown.
let katexPromise: Promise<typeof import("katex").default> | null = null;
function loadKatex() {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default);
  return katexPromise;
}

// publisher macros that plain LaTeX doesn't know
const MACROS = { "\\varvec": "\\mathbf{#1}", "\\mbox": "\\text{#1}", "\\hbox": "\\text{#1}" };

/**
 * Renders one LaTeX fragment with KaTeX. Shows the raw source until KaTeX loads, and keeps
 * showing it (as plain text) if the fragment doesn't parse. KaTeX output is trusted markup
 * we generate ourselves (trust: false), never the title's own HTML.
 */
export default function MathSpan({ tex }: { tex: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadKatex()
      .then((katex) => {
        const out = katex.renderToString(tex, { throwOnError: true, strict: "ignore", trust: false, output: "html", macros: MACROS });
        if (alive) setHtml(out);
      })
      .catch(() => alive && setHtml(null));
    return () => {
      alive = false;
    };
  }, [tex]);
  if (html === null) return <span className="math-raw">{tex}</span>;
  return <span className="math" dangerouslySetInnerHTML={{ __html: html }} />;
}
