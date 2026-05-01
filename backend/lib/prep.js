/**
 * AI meeting prep summaries.
 *
 * Calls Claude Haiku 4.5 with event metadata (title, description, start,
 * attendees, location) and returns a 3-bullet prep brief plus 2 suggested
 * questions to ask. Cheap (~$0.001 per event); cached on events_cache.
 *
 * No external Anthropic SDK — direct fetch to keep deps minimal.
 */

import { createHash } from 'crypto';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 350;

/**
 * Returns a stable hash of the inputs that affect the prep output.
 * If the hash hasn't changed, we serve cached prep.
 */
export function inputHash({ summary, description, startIso, location, attendees }) {
  const h = createHash('sha256');
  h.update(String(summary || ''));
  h.update('\x1f');
  h.update(String(description || ''));
  h.update('\x1f');
  h.update(String(startIso || ''));
  h.update('\x1f');
  h.update(String(location || ''));
  h.update('\x1f');
  h.update(JSON.stringify((attendees || []).map(a => a.email || a).sort()));
  return h.digest('hex').slice(0, 16);
}

import { getDefaultAi } from '../ai/registry.js';

export function isConfigured(userId = null) {
  if (userId) return !!getDefaultAi(userId);
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Generate a prep brief. Returns the markdown string.
 * Throws on API failure. Pass `userId` to use the user's chosen AI provider;
 * falls back to env-configured Anthropic for back-compat.
 */
export async function generatePrep({ summary, description, startIso, location, attendees, userId = null }) {
  // Resolve AI provider: user's preference, then any connected AI integration,
  // then the legacy env-configured Anthropic key.
  const ai = userId ? getDefaultAi(userId) : null;

  const attendeeList = (attendees || [])
    .map(a => a.displayName ? `${a.displayName} <${a.email}>` : a.email)
    .filter(Boolean)
    .join(', ');

  const userMessage = [
    `Title: ${summary || '(no title)'}`,
    startIso ? `Start: ${startIso}` : null,
    location ? `Location: ${location}` : null,
    attendeeList ? `Attendees: ${attendeeList}` : null,
    description ? `Description:\n${description}` : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = [
    'You write concise meeting-prep briefs for busy professionals.',
    'Return strictly Markdown. No preamble, no closing remarks. Keep it under 120 words.',
    'Structure:',
    '## Context',
    'One sentence summarizing what this meeting is about.',
    '## Prep',
    'Three bullet points the attendee should think about beforehand.',
    '## Questions to ask',
    'Two specific, useful questions tailored to the meeting topic.',
    'If the input is too sparse to prep meaningfully, say so honestly in one line.',
  ].join('\n');

  if (ai) {
    // User-chosen provider via the AI adapter.
    const text = await ai.adapter.chat({
      key: ai.key,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      model: ai.model,
      maxTokens: MAX_TOKENS,
      temperature: 0.5,
    });
    if (!text?.trim()) throw new Error(`Empty response from ${ai.adapter.name}`);
    return text.trim();
  }

  // Legacy fallback: env-configured Anthropic key.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No AI provider connected. Settings → AI to set one up.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data?.content || [])
    .filter(p => p?.type === 'text')
    .map(p => p.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty response from Anthropic');
  return text;
}
