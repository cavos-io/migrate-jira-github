import { fromADF } from "mdast-util-from-adf";
import { unified } from "unified";
import he from "he";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { ADFNode } from "../domain/models/ADFModels";

const mdProcessor = unified().use(remarkGfm).use(remarkStringify, {
  fences: true,
  bullet: "-",
  rule: "-",
  emphasis: "_",
  listItemIndent: "one",
});

/**
 * Convert ADF (Atlassian Document Format) to Markdown.
 */
export function adfToMarkdown(
  adf: ADFNode | ADFNode[],
  mentionMap: Record<string, string> = {}
): string {
  if (!adf) return "";

  const mapFn = (node: ADFNode): ADFNode => {
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
    if (node.type === "inlineCard" && node.attrs?.url) {
      const url = node.attrs.url as string;
      const key = url.match(/\/browse\/([^\/\?]+)/)?.[1] ?? url;
      return { type: "text", text: key, marks: node.marks ?? [] };
    }
    if (node.type === "media" && node.attrs?.id) {
      const alt = (node.attrs.alt as string) || "";
      const id = node.attrs.id as string;
      return {
        type: "text",
        text: `\n\n![${alt}](${id})\n\n`,
        marks: node.marks ?? [],
      };
    }
    return node;
  };

  const docs = Array.isArray(adf) ? adf : [adf];
  const remapped = docs.map((doc) =>
    (function traverse(n: ADFNode): ADFNode {
      if (!n || typeof n !== "object") return n;
      const m = mapFn(n);
      const clone: ADFNode = {
        ...m,
        attrs: m.attrs ? { ...m.attrs } : undefined,
      };
      if (Array.isArray(clone.content)) {
        clone.content = clone.content.map(traverse);
      }
      return clone;
    })(doc)
  );

  try {
    // **Note**: fromADF expects a plain object, so we cast to `any` here
    const md = remapped
      .map((doc) => mdProcessor.stringify(fromADF(doc as any)))
      .filter(Boolean)
      .join("\n\n");
    return he.decode(md);
  } catch (err: any) {
    console.error("ADF to Markdown conversion error:", err);
    return "";
  }
}
