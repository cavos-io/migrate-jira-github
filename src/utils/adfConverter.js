import { fromADF } from "mdast-util-from-adf";
import { unified } from "unified";
import he from "he";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";

const mdProcessor = unified()
  .use(remarkStringify, {
    fences: true,
    bullet: "-",
    rule: "-",
    emphasis: "_",
    listItemIndent: "one",
  })
  .use(remarkGfm);

export function adfToMarkdown(adf, mentionMap = {}) {
  if (!adf) return "";

  const mapFn = (node) => {
    if (node.type === "mention" && node.attrs?.id) {
      const raw = node.attrs.text ?? "";
      const clean = raw.startsWith("@") ? raw.slice(1) : raw;
      const user = mentionMap[node.attrs.id];
      return {
        type: "text",
        text: user ? `@${user}` : clean,
        marks: node.marks ?? [],
      };
    }
    return node;
  };

  const docs = Array.isArray(adf) ? adf : [adf];
  const remapped = docs.map((doc) =>
    (function traverse(n) {
      if (!n || typeof n !== "object") return n;
      const m = mapFn(n);
      const clone = { ...m, attrs: m.attrs ? { ...m.attrs } : undefined };
      if (Array.isArray(clone.content)) {
        clone.content = clone.content.map(traverse);
      }
      return clone;
    })(doc)
  );

  try {
    const md = remapped
      .map((doc) => mdProcessor.stringify(fromADF(doc)))
      .filter(Boolean)
      .join("\n\n");
    return he.decode(md);
  } catch (err) {
    console.error("❌ ADF to Markdown conversion error:", err);
    return "";
  }
}
