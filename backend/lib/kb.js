// Knowledgebase loader.
//
// Reads docs/help/**/*.md at startup, parses frontmatter, indexes by slug.
// Two consumers:
//   1. /help and /help/:slug routes (renders markdown to HTML)
//   2. AI support widget — provides searchable context to the LLM prompt
//
// We re-load on every request in dev (cheap; ~20 small files); in prod we
// cache the parsed result and only re-read on a SIGHUP-style reload.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KB_ROOT = join(__dirname, '..', '..', 'docs', 'help');

let cache = null;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

function buildIndex() {
  const files = walk(KB_ROOT);
  const articles = [];
  for (const path of files) {
    const raw = readFileSync(path, 'utf8');
    const { data, content } = matter(raw);
    // Slug derives from path: docs/help/api/auth.md → api/auth
    // The root-level docs/help/index.md → empty slug (the root path).
    const rel = relative(KB_ROOT, path).replace(/\\/g, '/').replace(/\.md$/, '');
    const slug = rel === 'index' ? '' : rel;
    articles.push({
      slug,
      title: data.title || slug || 'Untitled',
      description: data.description || '',
      body: content,
      path,
    });
  }
  return articles;
}

export function getArticles() {
  if (!cache) cache = buildIndex();
  return cache;
}

export function getArticle(slug) {
  return getArticles().find(a => a.slug === slug) || null;
}

export function reloadKb() { cache = null; }

// Render an article body to HTML. Pre-configured marked options that match
// our marketing site styling.
export function renderArticleHtml(article) {
  return marked.parse(article.body, { breaks: false, gfm: true });
}

// Returns the top N articles whose title or body best match a query, used
// for the AI chat's context retrieval. This is a deliberately simple scoring
// function — substring + token-overlap. Real semantic search via embeddings
// is a future-pass when the KB grows past ~50 articles.
export function searchArticles(query, limit = 4) {
  const articles = getArticles();
  if (!query || !query.trim()) return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(t => t.length >= 3);
  if (tokens.length === 0) return [];

  const scored = articles.map(a => {
    const haystack = `${a.title}\n${a.description}\n${a.body}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      // Title matches weighted heavier
      if (a.title.toLowerCase().includes(t)) score += 5;
      if (haystack.includes(t)) score += 1;
    }
    return { article: a, score };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.article);
}

// Returns a compact text representation of a list of articles, suitable for
// stuffing into an LLM system prompt. Trims to a token budget by character
// length (rough proxy: 4 chars ≈ 1 token).
export function articlesAsContext(articles, maxChars = 12000) {
  let total = 0;
  const parts = [];
  for (const a of articles) {
    const head = `## ${a.title}\n${a.description}\n\n`;
    const remain = Math.max(0, maxChars - total - head.length);
    if (remain < 100) break;
    const body = a.body.slice(0, remain);
    parts.push(head + body);
    total += head.length + body.length;
    if (total >= maxChars) break;
  }
  return parts.join('\n\n---\n\n');
}
