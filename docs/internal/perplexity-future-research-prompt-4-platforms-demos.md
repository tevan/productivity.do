# Part 4 of 5 — Platform layer, demographic shifts, sideways disruptions

I'm a solo founder building a productivity surface (calendar + tasks + notes + projects + files). Background: Svelte SPA + Express backend, Google Calendar sync, Todoist mirroring, markdown notes, lightweight projects (with due date, intent line, working-hour rhythm, momentum signal, and pin-to-decision-surface), voice capture that auto-routes input to task/event/note/comment via Claude Haiku, MCP server for external agents. The differentiation thesis is "be the place where someone or their agent makes the decision about what to do next." Solo founder, AI-native, tight build budget.

This is part 4 of 5 in a deeper research pass. Stay focused on this part only — I'm running the others as separate sessions.

Skip marketing fluff. Cite primary sources where possible (product docs, technical posts, founder interviews, regulatory filings, academic papers). Tell me what I'm wrong about.

## What I want you to research

### 1. The platform layer everyone forgets

What's happening at the layer below the app?

- **Apple Intelligence + App Intents.** What's possible in iOS 18 / 19? Which productivity apps have integrated? What is — and isn't — possible without becoming a default app?
- **Android equivalents.** Pixel-only Gemini features. Samsung. Where Google is going with Tasks + Calendar consolidation.
- **macOS / Windows OS-level integrations.** Stage Manager, virtual desktops, Microsoft Recall, Spotlight extensions, Raycast.
- **Web platform shifts.** PWAs, file system access, web speech, web USB / web Bluetooth as relevant. WebGPU for client-side AI.
- **Standards and protocols.** ICS, CalDAV, WebDAV, ActivityPub, Matrix, AT Protocol — which are gaining adoption in productivity-adjacent apps? Anything new (Solid, Bluesky's underlying protocol, etc.)?
- **The local-first movement.** Ink & Switch's research, CRDTs in production, Anytype, Logseq Sync. Is the "your data, your computer" thesis converging with anything mainstream?

### 2. Spatial / AR / wearable

- **Apple Vision Pro, Meta Ray-Ban, Quest** adoption. What productivity workflows actually exist on these? Cite specifics.
- **Spatial calendars / spatial notes** — anyone shipping? Any user data?
- **What happens to "the productivity app" if "calendar" becomes a 3D object floating beside you?** Reasonable timeline?

### 3. Demographic and behavioral shifts

The user a productivity app served in 2014 is not the user it serves in 2026, and the 2030 user is something else again:

- **Gen Z work patterns.** Are they using productivity apps at all? What replaces them? (TikTok-as-task-list isn't a joke for some segments — find evidence.)
- **Knowledge-worker job displacement.** If 30-50% of knowledge work is automated by 2030, who's left and what do they need?
- **The freelance / portfolio-career shift.** More project-juggling, less single-employer. How does that reshape what "projects" means?
- **Working hours collapse / four-day weeks / async work.** Where's this actually happening at scale?
- **Mobile-first / mobile-only workers.** What % of users never touch a desktop?
- **Geographic shifts.** Where is productivity-app adoption growing fastest (India, Brazil, SEA, Africa)? What do those users need that the SF/NY-built apps don't deliver?

### 4. Adjacent / sideways disruptions

Things that could obsolete the whole category:

- **Crypto / decentralized identity.** ENS, Lens, AT Protocol — does identity ever leave the email-and-OAuth model? Any productivity apps actually using these?
- **The death of email** for any non-trivial use case. Slack/Teams already won internal; is external next? What does that imply for "email-to-task" features?
- **Generative UI per session.** What if every productivity surface is generated on-demand from a description, no app needed? Vercel v0, Galileo, etc.
- **BCIs.** Probably 10+ years out but worth a brief scope.

## Output format

~2,000-3,500 words. Section headers matching the four numbered sections above. Cite primary sources inline.

End with **2 short sections**: (a) the platform shift most likely to matter to a solo productivity founder in 2026-2028, and (b) the demographic / behavioral shift most likely to redefine who "the user" is by 2030.
