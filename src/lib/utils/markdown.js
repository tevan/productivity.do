// Markdown rendering for notes. Uses `marked` for parsing, `dompurify` for
// XSS sanitization, and `highlight.js` (light subset) for code block syntax
// colors. The tradeoff: ~30KB extra in the bundle vs. user-supplied markup
// that could include scripts.
//
// All output is run through DOMPurify, so we can safely set innerHTML on the
// preview pane without worrying about <script> injection.

import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common'; // common langs only (~50KB vs full ~500KB)

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return code;
    }
  },
}));

marked.setOptions({
  gfm: true,           // GitHub-flavored: tables, strikethrough, task lists
  breaks: true,        // single \n becomes <br>
  pedantic: false,
});

// Render a markdown string to sanitized HTML.
export function renderMarkdown(src) {
  if (!src) return '';
  const dirty = marked.parse(src);
  return DOMPurify.sanitize(dirty, {
    // Allow checkbox inputs from GFM task lists.
    ADD_ATTR: ['target', 'type', 'checked', 'disabled'],
    ADD_TAGS: ['input'],
  });
}

// Slash command catalog. Each entry has a label, description, and a
// transform function that returns the new text + cursor offset for a given
// (textarea value, cursor position).
export const SLASH_COMMANDS = [
  { id: 'h1', label: 'Heading 1', desc: 'Large section title', insert: '# ' },
  { id: 'h2', label: 'Heading 2', desc: 'Medium subheading', insert: '## ' },
  { id: 'h3', label: 'Heading 3', desc: 'Small subheading', insert: '### ' },
  { id: 'list', label: 'Bulleted list', desc: '- item', insert: '- ' },
  { id: 'numbered', label: 'Numbered list', desc: '1. item', insert: '1. ' },
  { id: 'checklist', label: 'Checklist', desc: '- [ ] task', insert: '- [ ] ' },
  { id: 'quote', label: 'Quote', desc: '> blockquote', insert: '> ' },
  { id: 'code', label: 'Code block', desc: 'Fenced ``` code ```', insert: '```\n\n```\n', cursorOffset: 4 },
  { id: 'divider', label: 'Divider', desc: 'Horizontal rule', insert: '\n---\n\n' },
  { id: 'table', label: 'Table', desc: '2x2 markdown table', insert: '| Header | Header |\n| --- | --- |\n| Cell | Cell |\n' },
  { id: 'today', label: "Today's date", desc: 'Insert today as YYYY-MM-DD', insert: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } },
];

// Apply a slash command to a textarea's value at the cursor position. Returns
// { value, cursor } so the caller can write back state and reposition.
export function applySlash(value, cursor, cmd) {
  // The trigger '/' was at cursor-1; we strip it. Find the actual position.
  const triggerPos = value.lastIndexOf('/', cursor - 1);
  if (triggerPos < 0) return { value, cursor };
  const before = value.slice(0, triggerPos);
  const after = value.slice(cursor);
  const ins = typeof cmd.insert === 'function' ? cmd.insert() : cmd.insert;
  const cursorOffset = cmd.cursorOffset ?? ins.length;
  return {
    value: before + ins + after,
    cursor: before.length + cursorOffset,
  };
}

// Auto-format the line just typed if it matches a markdown trigger. Returns
// null if no transform applies; otherwise { value, cursor }.
//
// Triggers fire when the user types a SPACE (most cases) or after the user
// types ENTER on a line that ended with `---` (horizontal rule).
export function tryMarkdownShortcut(value, cursor, justTyped) {
  // Get the start of the current line (after last \n).
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const linePrefix = value.slice(lineStart, cursor);

  if (justTyped === ' ') {
    // Headings & blockquote already render naturally as markdown — no
    // transformation needed. The shortcut here is more about *visual cue*:
    // we leave the source as `# heading` and let preview render it. The
    // user gets the visible-formatting payoff in preview mode.
    //
    // The one transform we DO apply: convert `[]` (empty brackets) typed at
    // a list item into a checkbox. Common case: user types `- []` then
    // space, expecting `- [ ]`.
    if (linePrefix === '- []') {
      const newLine = '- [ ] ';
      return {
        value: value.slice(0, lineStart) + newLine + value.slice(cursor),
        cursor: lineStart + newLine.length,
      };
    }
  }

  if (justTyped === '\n') {
    // `---` followed by Enter → horizontal rule (already valid markdown,
    // but pad with a blank line so it renders cleanly).
    const trimmed = value.slice(lineStart, cursor - 1); // exclude the \n we just typed
    if (trimmed === '---') {
      const newSection = '---\n\n';
      return {
        value: value.slice(0, lineStart) + newSection + value.slice(cursor),
        cursor: lineStart + newSection.length,
      };
    }
    // Continue checklist on Enter: previous line was `- [ ] something`
    // → start the new line with `- [ ] `. Empty checklist line breaks out.
    const prevLineStart = value.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLine = value.slice(prevLineStart, lineStart - 1);
    const checkMatch = prevLine.match(/^(\s*)- \[ \] (.*)$/);
    if (checkMatch) {
      if (checkMatch[2].trim() === '') {
        // Empty checkbox line: remove it (break out of list).
        return {
          value: value.slice(0, prevLineStart) + value.slice(cursor),
          cursor: prevLineStart,
        };
      }
      const cont = `${checkMatch[1]}- [ ] `;
      return {
        value: value.slice(0, cursor) + cont + value.slice(cursor),
        cursor: cursor + cont.length,
      };
    }
    // Continue bulleted list similarly.
    const bulletMatch = prevLine.match(/^(\s*)- (.*)$/);
    if (bulletMatch && !checkMatch) {
      if (bulletMatch[2].trim() === '') {
        return {
          value: value.slice(0, prevLineStart) + value.slice(cursor),
          cursor: prevLineStart,
        };
      }
      const cont = `${bulletMatch[1]}- `;
      return {
        value: value.slice(0, cursor) + cont + value.slice(cursor),
        cursor: cursor + cont.length,
      };
    }
    // Continue numbered list: `N. text` → `N+1. ` (very simple counter).
    const numMatch = prevLine.match(/^(\s*)(\d+)\. (.*)$/);
    if (numMatch) {
      if (numMatch[3].trim() === '') {
        return {
          value: value.slice(0, prevLineStart) + value.slice(cursor),
          cursor: prevLineStart,
        };
      }
      const next = parseInt(numMatch[2], 10) + 1;
      const cont = `${numMatch[1]}${next}. `;
      return {
        value: value.slice(0, cursor) + cont + value.slice(cursor),
        cursor: cursor + cont.length,
      };
    }
  }

  return null;
}
