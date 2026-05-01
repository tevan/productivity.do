// Google Gemini adapter. Different request shape from OpenAI/Anthropic
// (Gemini uses `contents[]` with `parts[]`).

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const adapter = {
  provider: 'gemini',
  name: 'Google Gemini',
  description: 'Gemini is fast and cheap, with a generous free tier.',
  docsUrl: 'https://aistudio.google.com/app/apikey',
  defaultModel: 'gemini-1.5-flash',
  models: [
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (fast, cheap)' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro' },
  ],

  async validate(key) {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Gemini rejected this key (${res.status})`);
  },

  async chat({ key, system, messages, model = this.defaultModel, maxTokens = 600, temperature = 0.5 }) {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(
      `${BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const cand = json.candidates?.[0];
    return cand?.content?.parts?.map(p => p.text).join('') || '';
  },
};
