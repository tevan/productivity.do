// AI provider registry. Each adapter exports a `chat({ system, messages,
// model, maxTokens, temperature })` function returning the assistant's
// text. Provider-agnostic so feature code (lib/prep.js, NL parsing,
// suggestions) doesn't have to branch.
//
// User picks a default provider in Settings → AI. The adapter pulls the
// API key from integrations table where provider = 'ai_<name>'.

import { adapter as anthropic } from './anthropic/adapter.js';
import { adapter as openai }    from './openai/adapter.js';
import { adapter as gemini }    from './gemini/adapter.js';

const adapters = [anthropic, openai, gemini];
const byProvider = new Map(adapters.map(a => [a.provider, a]));

export function listAiAdapters() {
  return adapters.map(a => ({
    provider: a.provider,
    name: a.name,
    description: a.description,
    docsUrl: a.docsUrl,
    defaultModel: a.defaultModel,
    models: a.models,
  }));
}

export function getAiAdapter(provider) {
  return byProvider.get(provider) || null;
}

// Pick the user's preferred AI provider, falling back to the first one
// that has an API key configured. Returns { adapter, key, model }.
import { q } from '../db/init.js';
import { getIntegration } from '../integrations/store.js';

export function getDefaultAi(userId) {
  // Check the user's stored preference for which AI provider to use.
  const prefRow = q(
    'SELECT value FROM preferences WHERE user_id = ? AND key = ?'
  ).get(userId, 'aiProvider');
  let preferred = null;
  try { preferred = prefRow ? JSON.parse(prefRow.value) : null; } catch { preferred = prefRow?.value || null; }

  // Try preferred first, then any with a stored token.
  const order = preferred ? [preferred, ...adapters.map(a => a.provider)] : adapters.map(a => a.provider);
  for (const provider of order) {
    const adapter = byProvider.get(provider);
    if (!adapter) continue;
    const integration = getIntegration(userId, `ai_${provider}`);
    if (integration?.access_token) {
      const modelRow = q(
        'SELECT value FROM preferences WHERE user_id = ? AND key = ?'
      ).get(userId, `aiModel_${provider}`);
      let model;
      try { model = modelRow ? JSON.parse(modelRow.value) : null; } catch { model = modelRow?.value || null; }
      return { adapter, key: integration.access_token, model: model || adapter.defaultModel };
    }
  }
  // Fall back to env-configured Anthropic key (legacy ANTHROPIC_API_KEY)
  // for back-compat with the existing prep flow.
  if (process.env.ANTHROPIC_API_KEY) {
    return { adapter: anthropic, key: process.env.ANTHROPIC_API_KEY, model: anthropic.defaultModel };
  }
  return null;
}
