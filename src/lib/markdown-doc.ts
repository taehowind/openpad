// Bridges the editor's document model and the Markdown we actually store. Cards are persisted
// as Markdown so every existing renderer (board, detail popup, slideshow) keeps working.

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  type: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: Node[];
};

function serializeText(node: Node): string {
  if (node.type !== "text") return "";
  // No backslash escaping: renderMarkdown() has no unescaping step, so an escape would
  // survive into the rendered card as a literal backslash.
  let out = node.text ?? "";
  const marks = node.marks ?? [];
  // Innermost first so the wrappers nest in a stable order.
  if (marks.some((mark) => mark.type === "code")) out = `\`${node.text ?? ""}\``;
  if (marks.some((mark) => mark.type === "italic")) out = `*${out}*`;
  if (marks.some((mark) => mark.type === "bold")) out = `**${out}**`;
  const link = marks.find((mark) => mark.type === "link");
  if (link) {
    const href = String(link.attrs?.href ?? "");
    if (/^https?:\/\//i.test(href)) out = `[${out}](${href})`;
  }
  return out;
}

function serializeInline(nodes: Node[] | undefined): string {
  return (nodes ?? []).map((node) => (node.type === "hardBreak" ? "\n" : serializeText(node))).join("");
}

function serializeBlocks(nodes: Node[] | undefined, indent = ""): string[] {
  const lines: string[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Number(node.attrs?.level ?? 1));
        lines.push(`${indent}${"#".repeat(level)} ${serializeInline(node.content)}`);
        break;
      }
      case "codeBlock": {
        lines.push(`${indent}\`\`\``);
        for (const line of (node.content?.[0]?.text ?? "").split("\n")) lines.push(indent + line);
        lines.push(`${indent}\`\`\``);
        break;
      }
      case "bulletList":
      case "orderedList": {
        let index = Number(node.attrs?.start ?? 1);
        for (const item of node.content ?? []) {
          const marker = node.type === "bulletList" ? "-" : `${index++}.`;
          const [first, ...rest] = serializeBlocks(item.content, "");
          lines.push(`${indent}${marker} ${first ?? ""}`);
          for (const line of rest) lines.push(`${indent}  ${line}`);
        }
        break;
      }
      case "blockquote":
        for (const line of serializeBlocks(node.content, "")) lines.push(`${indent}> ${line}`);
        break;
      case "horizontalRule":
        lines.push(`${indent}---`);
        break;
      case "paragraph":
      default:
        lines.push(indent + serializeInline(node.content));
        break;
    }
  }
  return lines;
}

/** Editor document → the Markdown we store. */
export function docToMarkdown(doc: { content?: Node[] } | null | undefined): string {
  if (!doc?.content) return "";
  return serializeBlocks(doc.content).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
