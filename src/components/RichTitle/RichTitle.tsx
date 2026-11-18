import { Fragment, type ReactNode } from "react";
import { splitMath } from "../../lib/mathText";
import MathSpan from "./MathSpan";

/**
 * Paper titles from OpenAlex/Crossref carry inline markup (<sub>, <i>, MathML...).
 * This renders the typographic subset as real elements and strips the rest, keeping
 * its text. No innerHTML: unknown tags can never reach the DOM.
 */

const ALLOWED: Record<string, "sub" | "sup" | "i" | "b" | "scp"> = {
  sub: "sub",
  sup: "sup",
  i: "i",
  em: "i",
  b: "b",
  strong: "b",
  scp: "scp",
};

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

interface Node {
  tag: string | null; // null = root
  children: (Node | string)[];
}

function parse(src: string): Node {
  const root: Node = { tag: null, children: [] };
  const stack: Node[] = [root];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)[^>]*?(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    if (t) stack[stack.length - 1].children.push(decodeEntities(t));
  };
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!(name in ALLOWED)) continue; // unknown tag (font, mml:*...): drop the tag, keep its text
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      if (at > 0) stack.length = at; // tolerate unbalanced markup
    } else if (!m[3]) {
      const node: Node = { tag: name, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
  }
  text(src.slice(last));
  return root;
}

function render(node: Node, key = 0): ReactNode {
  const kids = node.children.map((c, i) =>
    typeof c === "string" ? (
      <Fragment key={i}>
        {splitMath(c).map((seg, j) => (seg.math ? <MathSpan key={j} tex={seg.text} /> : <Fragment key={j}>{seg.text}</Fragment>))}
      </Fragment>
    ) : (
      render(c, i)
    ),
  );
  switch (node.tag && ALLOWED[node.tag]) {
    case "sub":
      return <sub key={key}>{kids}</sub>;
    case "sup":
      return <sup key={key}>{kids}</sup>;
    case "i":
      return <i key={key}>{kids}</i>;
    case "b":
      return <b key={key}>{kids}</b>;
    case "scp":
      return (
        <span key={key} style={{ fontVariant: "small-caps" }}>
          {kids}
        </span>
      );
    default:
      return <Fragment key={key}>{kids}</Fragment>;
  }
}

export function RichTitle({ text }: { text: string }) {
  if (!/[<&$\\]/.test(text)) return <>{text}</>;
  return <>{render(parse(text))}</>;
}
