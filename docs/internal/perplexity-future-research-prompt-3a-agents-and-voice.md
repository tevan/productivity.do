# Part 3a of 8 — The agentic shift + voice as input

I'm a solo founder building a productivity surface (calendar + tasks + notes + projects + files). My current product: Svelte SPA + Express backend, Google Calendar sync, Todoist mirroring, markdown notes, lightweight projects (with due date, intent line, working-hour rhythm, momentum signal, pin-to-decision-surface), voice capture that auto-routes input to task/event/note/comment via Claude Haiku, MCP server for external agents. The differentiation thesis is "be the place where someone or their agent makes the decision about what to do next."

This is part 3a of an 8-part research pass. Stay focused on this part only — I'm running the others as separate sessions.

Skip marketing fluff. Cite primary sources where possible (product docs, technical posts, founder interviews). Tell me what I'm wrong about.

## What I want you to research

### 1. The agentic shift, in concrete detail

Specifics, not "AI is changing everything":

- **MCP / tool-use ecosystems today.** Anthropic MCP, OpenAI's tool-use, Apple Intelligence App Intents, Google Gemini Extensions, Microsoft Copilot connectors. Which are actually used in production? How many real apps? Activation trajectory? Where's the protocol fragmentation?
- **Productivity apps with first-party MCP / ChatGPT actions / App Intents.** Who shipped what surfaces? What patterns emerged? What broke?
- **Read vs. write balance for agents.** Are agents primarily reading (summarize my calendar) or writing (schedule a meeting on my behalf)? How are conflicts/permissions handled? Where do users actually consent vs. where are they surprised?
- **API discipline in an agent-first world.** Is the "API and webhook surface gets the same investment as UI" discipline still right, or does MCP/tool-use change the shape of what agents need? What does the equivalent of "API-first design" look like now?
- **The "personal AI" thesis** (Inflection / Pi-style). Did it die? Did it morph? What replaced it? What can a solo founder learn from those failures?
- **Agent-orchestrators eating apps from above.** Granola for meetings, Glean for search, Lindy/Crew/Cognosys for workflows. Which are sticking, which are fizzling?

### 2. Voice as input — adoption + use cases

- **OpenAI Voice Mode adoption.** Real numbers if available; what users do with it.
- **Apple Intelligence + Siri** — current state, productivity workflows that work.
- **Gemini Live** — adoption, what works, what doesn't.
- **What productivity workflows are people actually doing by voice in 2026?** Where does it fail (background noise, multi-step tasks, ambiguity)?
- **Voice → action pipelines** — push-to-talk vs. always-on, on-device vs. server-side classification.

## Output format

~1,500-2,000 words. Section headers matching the two numbered sections above. Cite primary sources inline.

End with **the 3 things a solo productivity founder should bet on for the agent + voice future** and **the 3 things to avoid**, with reasoning.
