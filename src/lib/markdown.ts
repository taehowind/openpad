// Minimal, safe Markdown → HTML. Input is HTML-escaped first, so the output is safe to
// inject with dangerouslySetInnerHTML. Only http/https links are allowed.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(text: string) {
  let out = text;
  // [label](https://url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic*
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  // `code`
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

type ListKind = "ul" | "ol";

export function renderMarkdown(input: string): string {
  const escaped = escapeHtml(input ?? "");
  const lines = escaped.split(/\r?\n/);
  let html = "";
  let list: ListKind | null = null;
  let inCode = false;
  let inQuote = false;
  const codeBuffer: string[] = [];

  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closeQuote = () => { if (inQuote) { html += "</blockquote>"; inQuote = false; } };
  const openList = (kind: ListKind) => {
    if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
  };

  for (const line of lines) {
    // Fenced code block — everything inside is emitted verbatim (already escaped).
    if (/^\s*```/.test(line)) {
      if (inCode) {
        html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`;
        codeBuffer.length = 0;
        inCode = false;
      } else {
        closeList();
        closeQuote();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      closeQuote();
      const level = heading[1].length + 1; // # → h2, so a card never emits an h1
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList();
      closeQuote();
      html += "<hr>";
      continue;
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      if (!inQuote) { html += "<blockquote>"; inQuote = true; }
      html += `<p>${inline(quote[1])}</p>`;
      continue;
    }
    closeQuote();

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      openList("ul");
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      openList("ol");
      html += `<li>${inline(ordered[1])}</li>`;
      continue;
    }

    closeList();
    if (line.trim() === "") { html += "<br>"; continue; }
    html += `<p>${inline(line)}</p>`;
  }

  if (inCode && codeBuffer.length > 0) html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`;
  closeList();
  closeQuote();
  return html;
}
