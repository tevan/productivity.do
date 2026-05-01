// Markdown / plain text → notes parser.
//
// Two modes, picked by the file content:
//   1. Single file → single note. Title = first H1 line if present,
//      otherwise the filename without extension. Body = rest.
//   2. ZIP / concatenated dump where notes are separated by `---` lines —
//      each block becomes a separate note. (ZIP unpacking happens in the
//      route handler; this parser sees pre-split text.)
//
// Future expansion: Bear, Obsidian, Notion HTML/MD exports each have
// their own quirks (frontmatter, wiki links, attachment references). v1
// just preserves the markdown text raw.

export function parseMarkdown(text, filename = 'Untitled') {
  if (!text) return { events: [], tasks: [], notes: [] };
  const blocks = text.split(/\n---+\n/);
  const notes = blocks
    .map(b => b.trim())
    .filter(Boolean)
    .map((body, idx) => {
      const m = body.match(/^#\s+(.+)$/m);
      const title = m ? m[1].trim()
        : (blocks.length === 1 ? filename.replace(/\.[^.]+$/, '') : `${filename} (${idx + 1})`);
      const stripped = m ? body.replace(m[0], '').trim() : body;
      return { title, body: stripped, pinned: false };
    });
  return { events: [], tasks: [], notes };
}
