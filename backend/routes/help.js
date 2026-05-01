// /help and /help/:slug — renders KB articles as HTML.
//
// Public (no auth) so search engines and unauthenticated users can read
// help articles. Marketing-friendly + indexable.

import express from 'express';
import { getArticle, getArticles, renderArticleHtml } from '../lib/kb.js';

const router = express.Router();

function pageShell({ title, description, contentHtml, currentSlug }) {
  const articles = getArticles();
  // Build the sidebar nav grouped by top-level directory.
  const groups = new Map();
  for (const a of articles) {
    if (a.slug === '') continue; // root index — skip in sidebar
    const dir = a.slug.includes('/') ? a.slug.split('/')[0] : 'general';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(a);
  }
  const groupOrder = ['getting-started', 'calendar', 'tasks', 'notes', 'booking', 'integrations', 'api', 'account', 'troubleshooting', 'general'];
  const groupLabels = {
    'getting-started': 'Getting started',
    calendar: 'Calendar',
    tasks: 'Tasks',
    notes: 'Notes',
    booking: 'Booking',
    integrations: 'Integrations',
    api: 'Developers',
    account: 'Account',
    troubleshooting: 'Troubleshooting',
    general: 'Other',
  };

  const navHtml = groupOrder
    .filter(g => groups.has(g))
    .map(g => `
      <h4>${groupLabels[g] || g}</h4>
      <ul>
        ${groups.get(g).map(a => `<li><a href="/help/${a.slug}" class="${a.slug === currentSlug ? 'active' : ''}">${a.title}</a></li>`).join('')}
      </ul>`)
    .join('');

  // Escape title for the <title> tag (description is rendered via attribute).
  const safe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${safe(title)} — productivity.do help</title>
  <meta name="description" content="${safe(description || '')}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/marketing/assets/marketing.css">
  <style>
    .help-layout { display: grid; grid-template-columns: 240px 1fr; gap: 32px; max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
    .help-nav { font-size: 13px; }
    .help-nav h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 18px 0 6px; }
    .help-nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .help-nav a { color: #374151; text-decoration: none; padding: 4px 8px; border-radius: 6px; display: block; }
    .help-nav a:hover { background: #f3f4f6; }
    .help-nav a.active { background: #3b82f6; color: white; font-weight: 500; }
    .help-article { font-size: 15px; line-height: 1.65; color: #1f2937; }
    .help-article h1 { font-size: 32px; margin: 0 0 8px; }
    .help-article h2 { font-size: 22px; margin: 32px 0 12px; }
    .help-article h3 { font-size: 17px; margin: 24px 0 8px; }
    .help-article a { color: #3b82f6; }
    .help-article code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
    .help-article pre { background: #1f2937; color: #f9fafb; padding: 12px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .help-article pre code { background: none; padding: 0; color: inherit; }
    .help-article ul, .help-article ol { padding-left: 24px; }
    .help-article table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    .help-article th, .help-article td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    .help-article th { background: #f9fafb; font-weight: 600; }
    .help-back { display: inline-block; margin-bottom: 16px; color: #6b7280; text-decoration: none; font-size: 13px; }
    .help-back:hover { color: #374151; }
    @media (max-width: 720px) {
      .help-layout { grid-template-columns: 1fr; gap: 16px; padding: 16px; }
      .help-nav { order: 2; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    }
  </style>
</head>
<body>
  <header class="marketing-nav">
    <a href="/home.html" class="brand">productivity.do</a>
    <nav>
      <a href="/features.html">Features</a>
      <a href="/pricing.html">Pricing</a>
      <a href="/help" class="active">Help</a>
      <a href="/login">Sign in</a>
    </nav>
  </header>
  <div class="help-layout">
    <aside class="help-nav">
      <a class="help-back" href="/help">← Help center</a>
      ${navHtml}
    </aside>
    <article class="help-article">
      ${contentHtml}
    </article>
  </div>
</body>
</html>`;
}

// /help — root TOC
router.get('/help', (req, res) => {
  const root = getArticle('') || { title: 'Help center', description: '', body: '' };
  const html = renderArticleHtml(root);
  res.type('html').send(pageShell({
    title: root.title,
    description: root.description,
    contentHtml: html,
    currentSlug: '',
  }));
});

// /help/:slug — individual articles. Slug can include slashes
// (e.g. `api/auth`) since we use a wildcard.
router.get(/^\/help\/(.+)$/, (req, res) => {
  const slug = req.params[0];
  const article = getArticle(slug);
  if (!article) {
    return res.status(404).type('html').send(pageShell({
      title: 'Article not found',
      description: '',
      contentHtml: `<h1>Not found</h1><p>That article doesn't exist. <a href="/help">Back to help center</a>.</p>`,
      currentSlug: '',
    }));
  }
  const html = renderArticleHtml(article);
  res.type('html').send(pageShell({
    title: article.title,
    description: article.description,
    contentHtml: html,
    currentSlug: slug,
  }));
});

export default router;
