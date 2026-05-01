// OpenAI adapter. Same shape — uses the chat-completions API.

const API = 'https://api.openai.com/v1/chat/completions';

export const adapter = {
  provider: 'openai',
  name: 'OpenAI (ChatGPT)',
  description: 'GPT models — great general-purpose chat and structured output.',
  docsUrl: 'https://platform.openai.com/api-keys',
  defaultModel: 'gpt-4o-mini',
  models: [
    { id: 'gpt-4o-mini',    label: 'GPT-4o mini (fast, cheap)' },
    { id: 'gpt-4o',         label: 'GPT-4o (balanced)' },
    { id: 'gpt-4-turbo',    label: 'GPT-4 Turbo' },
  ],

  async validate(key) {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`OpenAI rejected this key (${res.status})`);
  },

  async chat({ key, system, messages, model = this.defaultModel, maxTokens = 600, temperature = 0.5 }) {
    const fullMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  },
};
