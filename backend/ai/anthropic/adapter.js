// Anthropic adapter. Direct fetch — no SDK so we don't pull a megabyte
// of JS to make a single API call.

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export const adapter = {
  provider: 'anthropic',
  name: 'Anthropic Claude',
  description: 'Claude is best for nuanced text tasks — note summaries, prep briefings, NL parsing.',
  docsUrl: 'https://console.anthropic.com/settings/keys',
  defaultModel: 'claude-haiku-4-5-20251001',
  models: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap)' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (balanced)' },
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (best)' },
  ],

  async validate(key) {
    // Probe with a one-token completion. If the key is bad we'll get 401.
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic rejected this key (${res.status})`);
    }
  },

  async chat({ key, system, messages, model = this.defaultModel, maxTokens = 600, temperature = 0.5 }) {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: maxTokens,
        temperature,
        messages,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
};
