// Central adapter registry. Each integration implements a subset of:
//   { provider, kind: 'tasks'|'calendar'|'tasks+calendar'|'notes',
//     authType: 'oauth'|'pat'|'caldav',
//     authStartUrl, authCallback, authValidatePat, authValidateCaldav,
//     syncTasks, syncEvents,
//     createTask, updateTask, deleteTask, completeTask,
//     createEvent, updateEvent, deleteEvent,
//     disconnect }
//
// Adapters live in backend/integrations/<provider>/adapter.js. This file
// imports each one and exposes the lookup. The order here determines the
// order of providers in /api/integrations/list (used by the Settings UI).

import { adapter as todoist }       from './todoist/adapter.js';
import { adapter as googleTasks }   from './google-tasks/adapter.js';
import { adapter as googleCal }     from './google-calendar/adapter.js';
import { adapter as msCal }         from './microsoft-calendar/adapter.js';
import { adapter as msTodo }        from './microsoft-todo/adapter.js';
import { adapter as caldav }        from './caldav/adapter.js';
import { adapter as notion }        from './notion/adapter.js';
import { adapter as linear }        from './linear/adapter.js';
import { adapter as trello }        from './trello/adapter.js';
import { adapter as asana }         from './asana/adapter.js';
import { adapter as clickup }       from './clickup/adapter.js';
import { adapter as jira }          from './jira/adapter.js';
import { adapter as evernote }      from './evernote/adapter.js';
import { adapter as monday }        from './monday/adapter.js';

// Stub adapters — surfaced in the directory as "coming soon".
import { adapter as slack }         from './slack/adapter.js';
import { adapter as discord }       from './discord/adapter.js';
import { adapter as msTeams }       from './microsoft-teams/adapter.js';
import { adapter as telegram }      from './telegram/adapter.js';
import { adapter as pushover }      from './pushover/adapter.js';
import { adapter as ntfy }          from './ntfy/adapter.js';
// Tier-1 marketplace expansion: CalDAV pre-fills, native task tools, PKM,
// competitor imports, fitness, content-publishing surfaces, etc.
import { adapter as appleCal }      from './apple-calendar/adapter.js';
import { adapter as yahooCal }      from './yahoo-calendar/adapter.js';
import { adapter as fastmail }      from './fastmail/adapter.js';
import { adapter as protonCal }     from './proton-calendar/adapter.js';
import { adapter as appleReminders } from './apple-reminders/adapter.js';
import { adapter as things }        from './things/adapter.js';
import { adapter as ticktick }      from './ticktick/adapter.js';
import { adapter as obsidian }      from './obsidian/adapter.js';
import { adapter as coda }          from './coda/adapter.js';
import { adapter as airtable }      from './airtable/adapter.js';
import { adapter as heyEmail }      from './hey-email/adapter.js';
import { adapter as sparkEmail }    from './spark-email/adapter.js';
import { adapter as calendly }      from './calendly/adapter.js';
import { adapter as savvycal }      from './savvycal/adapter.js';
import { adapter as calcom }        from './calcom/adapter.js';
import { adapter as tripit }        from './tripit/adapter.js';
import { adapter as appleHealth }   from './apple-health/adapter.js';
import { adapter as healthConnect } from './health-connect/adapter.js';
import { adapter as strava }        from './strava/adapter.js';
import { adapter as garmin }        from './garmin/adapter.js';
import { adapter as beehiiv }       from './beehiiv/adapter.js';
import { adapter as mailchimp }     from './mailchimp/adapter.js';
import { adapter as buffer }        from './buffer/adapter.js';
import { adapter as hootsuite }     from './hootsuite/adapter.js';
import { adapter as later }         from './later/adapter.js';
import { adapter as stripeCheckin } from './stripe-checkin/adapter.js';
// Tier-2 marketplace expansion.
import { adapter as roam }          from './roam/adapter.js';
import { adapter as logseq }        from './logseq/adapter.js';
import { adapter as bear }          from './bear/adapter.js';
import { adapter as mem }           from './mem/adapter.js';
import { adapter as appleNotes }    from './apple-notes/adapter.js';
import { adapter as gitlab }        from './gitlab/adapter.js';
import { adapter as gitea }         from './gitea/adapter.js';
import { adapter as bitbucket }     from './bitbucket/adapter.js';
import { adapter as shortcut }      from './shortcut/adapter.js';
import { adapter as sentryAdapter } from './sentry/adapter.js';
import { adapter as pocket }        from './pocket/adapter.js';
import { adapter as readwise }      from './readwise/adapter.js';
import { adapter as instapaper }    from './instapaper/adapter.js';
import { adapter as matter }        from './matter/adapter.js';
import { adapter as habitica }      from './habitica/adapter.js';
import { adapter as streaks }       from './streaks/adapter.js';
import { adapter as beeminder }     from './beeminder/adapter.js';
import { adapter as substack }      from './substack/adapter.js';
import { adapter as front }         from './front/adapter.js';
import { adapter as helpscout }     from './helpscout/adapter.js';
import { adapter as zendesk }       from './zendesk/adapter.js';
import { adapter as intercom }      from './intercom/adapter.js';
import { adapter as basecamp }      from './basecamp/adapter.js';
import { adapter as wrike }         from './wrike/adapter.js';
import { adapter as quickbooks }    from './quickbooks/adapter.js';
import { adapter as zoom }          from './zoom/adapter.js';
import { adapter as googleMeet }    from './google-meet/adapter.js';
import { adapter as googleDrive }   from './google-drive/adapter.js';
import { adapter as dropbox }       from './dropbox/adapter.js';
import { adapter as onedrive }      from './onedrive/adapter.js';
import { adapter as box }           from './box/adapter.js';
import { adapter as googleDocs }    from './google-docs/adapter.js';
import { adapter as googleSheets }  from './google-sheets/adapter.js';
import { adapter as googleSlides }  from './google-slides/adapter.js';
import { adapter as office365 }     from './office365/adapter.js';
import { adapter as gmail }         from './gmail/adapter.js';
import { adapter as toggl }         from './toggl/adapter.js';
import { adapter as harvest }       from './harvest/adapter.js';
import { adapter as clockify }      from './clockify/adapter.js';
import { adapter as typeform }      from './typeform/adapter.js';
import { adapter as googleForms }   from './google-forms/adapter.js';
import { adapter as jotform }       from './jotform/adapter.js';
import { adapter as miro }          from './miro/adapter.js';
import { adapter as lucidchart }    from './lucidchart/adapter.js';
import { adapter as figma }         from './figma/adapter.js';
import { adapter as canva }         from './canva/adapter.js';
import { adapter as hubspot }       from './hubspot/adapter.js';
import { adapter as salesforce }    from './salesforce/adapter.js';
import { adapter as twilio }        from './twilio/adapter.js';
import { adapter as zapier }        from './zapier/adapter.js';
import { adapter as make }          from './make/adapter.js';
import { adapter as n8n }           from './n8n/adapter.js';
import { adapter as ifttt }         from './ifttt/adapter.js';
import { adapter as pipedream }     from './pipedream/adapter.js';
import { adapter as workato }       from './workato/adapter.js';
import { adapter as activepieces }  from './activepieces/adapter.js';

const adapters = [
  // Calendar
  googleCal, msCal, caldav, appleCal, fastmail, protonCal, yahooCal, tripit,
  // Tasks
  todoist, googleTasks, msTodo, appleReminders, things, ticktick, notion, linear, trello, airtable, asana, clickup, jira, monday,
  basecamp, wrike, gitlab, gitea, bitbucket, shortcut, sentryAdapter, zendesk, intercom, habitica, streaks, beeminder,
  // Notes
  evernote, obsidian, roam, logseq, bear, mem, appleNotes, readwise, pocket, instapaper, matter,
  // Email
  gmail, heyEmail, sparkEmail, front, helpscout,
  // Storage
  googleDrive, dropbox, onedrive, box,
  // Docs
  googleDocs, googleSheets, googleSlides, office365, coda,
  // Meetings (incl. competitor imports)
  zoom, googleMeet, calendly, savvycal, calcom,
  // Communication
  slack, discord, msTeams, telegram, pushover, ntfy, beehiiv, mailchimp, buffer, hootsuite, later, substack,
  // Time / fitness / context
  toggl, harvest, clockify, strava, garmin, appleHealth, healthConnect, stripeCheckin, quickbooks,
  // Forms
  typeform, googleForms, jotform,
  // Whiteboards
  miro, lucidchart,
  // Design
  figma, canva,
  // CRM
  hubspot, salesforce,
  // SMS
  twilio,
  // Automation
  zapier, make, n8n, ifttt, pipedream, workato, activepieces,
];

const byProvider = new Map(adapters.map(a => [a.provider, a]));

export function getAdapter(provider) {
  return byProvider.get(provider) || null;
}

export function listAdapters() {
  return adapters.map(a => ({
    provider: a.provider,
    name: a.name,
    kind: a.kind,
    category: a.category || a.kind,
    status: a.status || 'stable',
    mode: a.mode || 'sync',
    recommended: !!a.recommended,
    authType: a.authType,
    description: a.description || '',
    docsUrl: a.docsUrl || null,
    syncEnabled: a.syncEnabled !== false,
    requiresEnv: a.requiresEnv || [],
  }));
}

export function adaptersForKind(kind) {
  // kind is 'tasks' | 'calendar' | 'notes'. An adapter's kind can be a
  // composite like 'tasks+calendar' — we match if the requested kind
  // appears in the composite.
  return adapters.filter(a => (a.kind || '').split('+').includes(kind));
}
