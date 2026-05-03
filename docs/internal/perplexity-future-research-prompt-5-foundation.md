# Part 5 of 5 — Foundation, architecture, and "if I were starting today"

I'm a solo founder building a productivity surface (calendar + tasks + notes + projects + files). Current stack is Svelte + Express + SQLite, with Google Calendar sync, Todoist mirroring, voice capture via Whisper/Claude, and an MCP server for external agents. The differentiation thesis is "be the place where someone or their agent makes the decision about what to do next." Solo founder with AI leverage and design taste. Considering a rebuild.

This is part 5 of 5 in a deeper research pass. Stay focused on this part only — I'm running the others as separate sessions.

Skip marketing fluff. Cite primary sources where possible (founder posts, GitHub repos, academic papers, technical talks). Tell me what I'm wrong about.

## What I want you to research

### 1. Schema design — what data model survives 5-7 years

Walk through the data-model approaches actually used in production by leading products:

- **Linear's data model.** Multiple founders have called it "the right one." What's actually distinctive? (Sources: Linear's engineering blog, Karri Saarinen interviews, RFC posts.)
- **Notion's block model.** Why every block is a row; what it costs them; why it's hard to clone.
- **Obsidian / Logseq / Roam graph model.** Bi-directional links, transclusion. What works, what doesn't scale.
- **Event-sourcing in productivity apps.** Anyone doing this in production?
- **CRDTs in the wild.** Automerge, Yjs, Liveblocks. Which productivity apps have shipped CRDT-based sync? What broke?
- **Document-shaped vs. row-shaped vs. graph-shaped.** Trade-offs for a tool that has to handle calendar (time-bound), tasks (item-bound), notes (free-form), projects (grouping), files (binary blobs).

What's the right substrate for a productivity surface that needs to be agent-readable, locally-queryable, and survive 10 years of feature growth?

### 2. API / MCP / agent-readable architecture

If agents are a primary consumer in 3 years, what does an agent-first API look like, technically?

- **Tool-call shape.** What makes a good MCP tool description? Anthropic's docs, real-world examples from production MCP servers (Linear's, Todoist's, Notion's if any).
- **Idempotency and retries.** How do real MCP servers handle agent tool-calls that fail mid-stream?
- **Partial reads / streaming.** When an agent asks for "today's tasks," should it get a paginated stream or a full payload?
- **Permissions and scopes.** OAuth scopes for agents — what models work? What do Anthropic and OpenAI recommend?
- **Conversational UX inside the app.** Apps like Notion, Linear, and Obsidian are adding chat panels. What's working vs. what's being removed after launch?
- **Webhooks vs. agent polling.** Where's the line in 2026?

### 3. Local-first vs. server-of-record

Where does the data live in the next 5 years?

- **Ink & Switch's local-first research.** Current state, what's been adopted in production.
- **Anytype, Logseq Sync, Obsidian Sync.** Real users, real revenue. What are they actually selling?
- **Sync engines.** Replicache, ElectricSQL, PowerSync, Liveblocks, RxDB, TinyBase. Which are production-ready? Which are dying? Which fit a productivity tool?
- **The "edge sync" middle path.** Cloudflare Durable Objects, Supabase Realtime, Convex. Any real productivity apps building on these?
- **Offline-first as a moat?** Does "your data lives on your device" actually drive adoption / retention, or is it a niche-power-user belief?

### 4. Search & voice surfaces — server architecture

Search:
- **Glean, Dropbox Dash, Notion Q&A** — what stack, what indexing, what works.
- **Vector search in productivity** — anyone shipping at scale? Pinecone, Weaviate, Turbopuffer, Lance. What's actually working vs. demo?
- **Hybrid (BM25 + vector + structured) search.** Real implementations.
- **Semantic search for personal data.** The privacy angle — local embedding models (Xenova, Ollama).

Voice:
- **Whisper at scale.** Self-hosted vs. OpenAI hosted. Latency, cost, accuracy in 2026.
- **Real-time streaming transcription.** OpenAI Realtime, Deepgram, AssemblyAI. Best practices for productivity apps.
- **Voice classifiers.** Routing voice intent to task/event/note/comment — patterns from real apps.
- **Voice in the browser.** Web Speech API limitations in 2026. WebAssembly Whisper for client-side.

### 5. Composability and extensibility

- **Obsidian's plugin architecture** — community size, retention, monetization.
- **VS Code's extension model** — overkill for productivity?
- **Raycast's command model** — best balance for productivity?
- **Notion's API + custom blocks** — why most of it sat unused.
- **Tana's supertags / Capacities' content types** — user-extensible schema. Adoption?
- **The right "extension point" for agents specifically** — beyond MCP, what should solo-built productivity apps expose?

### 6. The "if I were starting today" recommendation

Final, opinionated take. A solo founder with AI-leverage and design taste, starting fresh today, building for a 5-year horizon. What's the right shape?

- **What's the wedge?** Calendar? Tasks? Notes? A specific job-to-be-done that doesn't yet have a clear owner?
- **What's the substrate?** Schema, stack, deployment model, sync engine.
- **What's deliberately omitted?** Notion-shaped flexibility? Email? Storage? Per-user collaboration?
- **What's the moat?** Data graph? Agent integrations? Brand? Network effects? Switching cost?
- **What's the monetization?** Pricing, channel, expansion path.
- **Who's the customer?** Specific persona, not "knowledge workers." Demographic, behavior, willingness-to-pay.
- **What gets it killed?** Top 3 risks ranked by probability, with mitigation if any.
- **What's the 12-month roadmap?** What ships in week 1, month 3, month 12.

## Output format

~2,500-4,000 words. Section headers matching the six numbered sections above. Cite primary sources inline.

End with **a single-page architectural recommendation**: schema shape, stack, sync model, agent surface, voice surface, search surface, pricing, monetization, and the one thing deliberately omitted from v1. Be opinionated and specific.
