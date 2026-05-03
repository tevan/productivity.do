# Future-of-the-space research prompt (full version)

This is the full, unsplit prompt. Perplexity has timed out trying to write the
report from this in one pass — the split versions in
`perplexity-future-research-prompt-{1,2,3}-*.md` are the runnable ones.

Save responses as `perplexity-future-research-response.md` (one combined file
when all three parts have come back).

---

I'm a solo founder building a productivity surface (calendar + tasks + notes + projects + files) and trying to decide whether to keep iterating or rebuild from scratch. I need a deep research report on where this space is going over the next 3-7 years so I can decide what to bet on. Skip the marketing fluff and cite primary sources where possible (product docs, founder interviews, technical posts, S-1s, earnings calls, GitHub repos, academic papers, regulatory filings).

## Background you should know

The current product combines calendar (Google Calendar sync), tasks (Todoist mirror), notes (markdown), and lightweight projects (a project is a labeled bucket with metadata: due date, intent line, rhythm, momentum signal, pin-to-decision-surface). It's a Svelte SPA + Express backend. The differentiation thesis is "be the place where someone or their agent makes the decision about what to do next" — time-aware projects, deterministic ranking, voice capture that auto-routes to the right pillar, MCP server so external agents can read and shape the decision surface. The space is well-served by giants (Notion, Linear, Todoist, Apple, Google) and the moats in this category have historically been shallow.

I want a brutally honest read on whether the bet I'm making survives the next 3-7 years, what disruptions could obsolete it, and what an "extensible-but-simple" foundation would look like if I rebuilt from scratch today knowing what's coming.

## What I want you to research

### 1. The competitive and consolidation landscape (current state, with citations)

For each of these categories, give me the 3-5 most-relevant players, their funding/revenue/users where public, what's actually working for them right now, and what their public roadmap suggests:

- **Calendar-centric:** Google Calendar, Apple Calendar, Cron/Notion Calendar, Vimcal, Fantastical, Cal.com, Calendly, Sunsama, Akiflow, Motion, Reclaim
- **Task-centric:** Todoist, Things, OmniFocus, Linear, TickTick, Asana, ClickUp, Microsoft To Do, Apple Reminders
- **Notes-centric:** Notion, Apple Notes, Bear, iA Writer, Mem, Capacities, Obsidian, Logseq, Roam, Reflect, Cosmos, NotebookLM
- **Project-centric:** Linear, Asana, ClickUp, Monday, Basecamp, Height, Trello
- **Email-as-productivity-surface:** Superhuman, Hey, Shortwave, Spike
- **Storage-as-thinking:** Dropbox Dash, Google Drive, OneDrive, Box, Mem
- **Hybrid / "second brain" / "OS for work":** Notion, Coda, Tana, Capacities, Anytype, Heyday, Saga
- **AI-native productivity entrants 2024-2026:** Granola, Reflect, Mem AI, Glean, Arc Search, ChatGPT Tasks/Projects, Claude Projects, Notion AI, AmieMagic, Rewind/Limitless, Krisp, Otter, Fellow

For each: what's their actual differentiation today vs. table-stakes, what's monetizing, what's collapsing, and which feature surfaces are getting commoditized fastest.

### 2. The agentic shift, in concrete detail

This is the disruption I'm most worried about. I want specifics, not "AI is changing everything":

- **What MCP / tool-use ecosystems exist today?** Anthropic MCP, OpenAI's tool-use, Apple Intelligence App Intents, Google Gemini Extensions, Microsoft Copilot connectors. Which of these are actually being used by real apps in production? What's the activation trajectory?
- **Which productivity apps have shipped first-party MCP servers, ChatGPT actions, or App Intents?** What surfaces did they expose? What patterns emerged?
- **Where are agents reading from vs. writing to?** Is it primarily read-only (summarize my calendar) or write (schedule a meeting on my behalf)? How are conflicts/permissions handled?
- **Is the "API and webhook surface" still the right discipline, or does MCP/tool-use change the shape of what agents need?** What does the equivalent of "API-first design" look like in an agent-first world?
- **Voice + agents specifically.** OpenAI's voice mode, Apple Intelligence + Siri, Gemini Live. What productivity workflows are people actually doing by voice in 2026? Where does it fail?
- **The "personal AI" thesis** (Inflection / Pi-style). Did it die? Did it morph? What replaced it?

### 3. Ambient / passive capture

The Mem and Granola observation: capture friction is the bottleneck. What's solving it?

- Voice capture (AirPods always-on, Rabbit R1, Humane Pin postmortem, Limitless pendant, Plaud)
- Screen-recording-as-memory (Rewind, Limitless, Microsoft Recall — what happened with the privacy backlash)
- Email-as-capture-source (forwarding into Mem, Reflect, etc.)
- Meeting transcription (Granola vs Otter vs Fellow vs Fireflies vs Zoom AI Companion vs Read.ai)
- Browser extensions as ambient capture
- Mobile share-sheet flows
- What's working, what's been shut down (Humane Pin failed, Rabbit R1 stalled), what's next

### 4. The "death of the app" thesis vs. the "destination app" counter-thesis

Two competing futures:

**A. Apps dissolve into agent surfaces.** ChatGPT/Claude/Gemini become the front door; productivity apps are commodity backends accessed via MCP. UI lives in the chat surface or in glanceable widgets (Apple Intelligence summaries, Pixel "At a Glance"). Apps that survive are those that own *unique data* that can't be reconstituted from elsewhere.

**B. Destination apps strengthen.** Generative UI is too noisy; users want a coherent surface they can muscle-memory through. Apps that win are those that become the place specific decisions get made (Linear for engineering work, Cal.com for booking, Notion for docs).

What's the evidence for each? Are there sub-categories of productivity where one is winning? Cite specific user-research / product-strategy posts where founders have publicly committed to one or the other.

### 5. Data moats in a commodity-model era

If transcription is free, summarization is free, classification is free, and the model is free — what's left to defend?

- **Cross-reference moats** (your Notion is connected to your Slack is connected to your Drive is connected to your calendar — switching means rebuilding all of it). Is this real or apocryphal?
- **Behavioral moats** (muscle memory, keyboard shortcuts, workflows). How long do these actually retain users? Is there research?
- **Network effects in single-player productivity.** Most of these are non-collaborative; do any have network effects? (Booking pages? Templates? Public shared notes a la Substack?)
- **Compliance / sovereignty / on-prem.** Does selling to enterprises as the path to defensibility actually work for solo / small-team founders, or is it a trap?
- **Personal-data-graph moats.** Does owning a user's task history → estimation accuracy → forecasting actually translate to retention, or is it overhyped?
- **Switching costs in productivity historically.** What's the half-life of churn at Todoist, Things, Notion, Bear? Any public data?

### 6. The platform layer everyone forgets

What's happening at the layer below the app?

- **Apple Intelligence + App Intents.** What's possible in iOS 18 / 19? Which productivity apps have integrated? What is — and isn't — possible without becoming a default app?
- **Android equivalents.** Pixel-only Gemini features. Samsung. Where Google is going with Tasks + Calendar consolidation.
- **macOS / Windows OS-level integrations.** Stage Manager, virtual desktops, Microsoft Recall, Spotlight extensions, Raycast.
- **Web platform shifts.** PWAs, file system access, web speech, web USB / web Bluetooth as relevant. WebGPU for client-side AI.
- **Standards and protocols.** ICS, CalDAV, WebDAV, ActivityPub, Matrix, AT Protocol — which are gaining adoption in productivity-adjacent apps? Anything new (Solid, Bluesky's underlying protocol, etc.)?
- **The local-first movement.** Ink & Switch's research, CRDTs in production, Anytype, Logseq Sync. Is the "your data, your computer" thesis converging with anything mainstream?

### 7. Demographic and behavioral shifts

The user a productivity app served in 2014 is not the user it serves in 2026, and the 2030 user is something else again:

- **Gen Z work patterns.** Are they using productivity apps at all? What replaces them? (TikTok-as-task-list isn't a joke for some segments.)
- **Knowledge-worker job displacement.** If 30-50% of knowledge work is automated by 2030, who's left and what do they need?
- **The freelance / portfolio-career shift.** More project-juggling, less single-employer. How does that reshape what "projects" means?
- **Working hours collapse / four-day weeks / async work.** Where's this actually happening at scale?
- **Mobile-first / mobile-only workers.** What % of users never touch a desktop?

### 8. Adjacent disruptions that hit this space sideways

Things that could obsolete the whole category:

- **Foundation models with persistent memory.** OpenAI's memory feature, Anthropic's memory product, Google's contextual continuity — if the LLM remembers everything, do I need notes?
- **Spatial / AR.** Vision Pro adoption, Meta Ray-Ban. If "calendar" becomes a 3D object floating beside you, what changes?
- **BCIs.** Probably 10+ years out but worth scoping.
- **Crypto / decentralized identity.** ENS, Lens, AT Protocol — does identity ever leave the email-and-OAuth model?
- **The death of email** for any non-trivial use case. Slack/Teams already won internal; is external next?
- **Generative UI per session.** What if every productivity surface is generated on-demand from a description, no app needed?

### 9. What does an "extensible foundation" look like for the next 5-7 years?

Given everything above, what does the *substrate* look like for a productivity surface that can survive the next decade? I want concrete architectural recommendations:

- **Schema design.** What's the right data model? Is it event-sourced? CRDT-based? Graph-shaped? Document-shaped? What does Linear's data model actually look like (it's been called "the right one" by several founders)?
- **API / MCP / agent-readability.** What does an agent-first API look like, technically? Tool-call shape, idempotency, partial reads, etc.
- **Local-first vs. server-of-record.** Where does the data live in the next 5 years? What's the right hybrid?
- **Search as primary interface.** How are the best products handling unified search across calendar + tasks + notes? What index, what stack?
- **Voice as a primary input.** Server architecture for voice-in (Whisper, real-time streaming, push-to-talk patterns).
- **Composable / extensible.** Plugin architectures (Obsidian, VS Code, Raycast). What's the right level of extensibility for a productivity surface — none, full plugin SDK, or middle path?
- **Pricing models that survive AI commoditization.** Per-user SaaS is under pressure. What's working — usage-based, hybrid, lifetime, sovereign-data, white-label?

### 10. The "if I were starting today" recommendation

After all of the above, give me your honest, opinionated take: if a solo founder with strong AI-leverage and design taste was starting fresh today, building for a 5-year horizon, what would the right shape be?

- What's the wedge? (Calendar? Tasks? Notes? A specific job-to-be-done?)
- What's the substrate? (Schema, stack, deployment model.)
- What's deliberately omitted? (Notion-shaped flexibility? Email? Storage?)
- What's the moat? (Data graph? Agent integrations? Brand? Network effects?)
- What's the monetization? (Pricing, channel.)
- Who's the customer? (Specific persona, not "knowledge workers.")
- What gets it killed? (Top 3 risks, in order.)

## Output format

Long-form report, ~5,000-15,000 words. Section headers matching the numbered list above. Cite primary sources inline. Disagree with conventional wisdom where the evidence supports it. Tell me what I'm wrong about.

End with a one-page executive summary of the 5 most-load-bearing decisions a founder in this space needs to make in 2026, and what the evidence currently suggests for each.
