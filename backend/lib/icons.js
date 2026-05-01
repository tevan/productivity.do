// Brand icons for the marketplace, sourced from the simple-icons package.
//
// We ship the icons via a server endpoint (`GET /api/icons/:provider.svg`)
// rather than bundling all 3429 SVGs into the SPA. The mapping below is
// hand-curated because simple-icons slugs don't always match our provider
// keys (e.g. `microsoft_calendar` → `microsoftoutlook`, `google_calendar`
// → `googlecalendar`).
//
// Providers without a simple-icons match get a generic letter avatar from
// the route handler — no entry needed in this map.

import * as si from 'simple-icons';

// Provider → simple-icons slug. Slug matches the lowercase part after `si`.
const PROVIDER_TO_SLUG = {
  // Calendar
  google_calendar: 'googlecalendar',
  microsoft_calendar: 'microsoftoutlook',
  apple_calendar: 'apple',
  yahoo_calendar: 'yahoo',
  fastmail: 'fastmail',
  proton_calendar: 'protonmail',
  caldav: null, // generic protocol
  tripit: 'tripit',

  // Tasks
  todoist: 'todoist',
  google_tasks: 'googletasks',
  microsoft_todo: 'microsofttodo',
  apple_reminders: 'apple',
  things: 'thingsapp',
  ticktick: 'ticktick',
  notion: 'notion',
  linear: 'linear',
  trello: 'trello',
  airtable: 'airtable',
  asana: 'asana',
  clickup: 'clickup',
  jira: 'jira',
  monday: 'mondaydotcom',
  basecamp: 'basecamp',
  wrike: 'wrike',
  gitlab: 'gitlab',
  gitea: 'gitea',
  bitbucket: 'bitbucket',
  shortcut: 'shortcut',
  sentry: 'sentry',
  zendesk: 'zendesk',
  intercom: 'intercom',
  habitica: 'habitica',
  streaks: null,
  beeminder: null,

  // Notes
  evernote: 'evernote',
  obsidian: 'obsidian',
  roam: null,
  logseq: 'logseq',
  bear: null,
  mem: null,
  apple_notes: 'apple',
  readwise: 'readwise',
  pocket: 'pocket',
  instapaper: 'instapaper',
  matter: null,

  // Email
  gmail: 'gmail',
  hey_email: 'hey',
  spark_email: null,
  front: 'frontify',
  helpscout: null,

  // Storage
  google_drive: 'googledrive',
  dropbox: 'dropbox',
  onedrive: 'microsoftonedrive',
  box: 'box',

  // Docs
  google_docs: 'googledocs',
  google_sheets: 'googlesheets',
  google_slides: 'googleslides',
  office365: 'microsoftoffice',
  coda: null,

  // Meetings
  zoom: 'zoom',
  google_meet: 'googlemeet',
  calendly: null,
  savvycal: null,
  calcom: null,

  // Communication
  slack: 'slack',
  discord: 'discord',
  microsoft_teams: 'microsoftteams',
  telegram: 'telegram',
  pushover: null,
  ntfy: null,
  beehiiv: null,
  mailchimp: 'mailchimp',
  buffer: 'buffer',
  hootsuite: 'hootsuite',
  later: null,
  substack: 'substack',

  // Time / fitness / context
  toggl: 'toggl',
  harvest: null,
  clockify: 'clockify',
  strava: 'strava',
  garmin: 'garmin',
  apple_health: 'apple',
  health_connect: 'googlefit',
  stripe_checkin: 'stripe',
  quickbooks: 'quickbooks',

  // Forms
  typeform: 'typeform',
  google_forms: 'googleforms',
  jotform: 'jotform',

  // Whiteboards
  miro: 'miro',
  lucidchart: 'lucidchart',

  // Design
  figma: 'figma',
  canva: 'canva',

  // CRM
  hubspot: 'hubspot',
  salesforce: 'salesforce',

  // SMS
  twilio: 'twilio',

  // Automation
  zapier: 'zapier',
  make: null,
  n8n: 'n8n',
  ifttt: 'ifttt',
  pipedream: 'pipedream',
  workato: null,
  activepieces: null,
};

function siKeyFor(slug) {
  // simple-icons exports `si<PascalCase>`; their `slug` field is what we map.
  if (!slug) return null;
  const key = 'si' + slug.charAt(0).toUpperCase() + slug.slice(1);
  return si[key] ? key : null;
}

// Returns { svg, hex, title } or null.
export function getProviderIcon(provider) {
  const slug = PROVIDER_TO_SLUG[provider];
  if (!slug) return null;
  const key = siKeyFor(slug);
  if (!key) return null;
  const icon = si[key];
  return { svg: icon.svg, hex: `#${icon.hex}`, title: icon.title };
}

// Generic letter-tile fallback. Used when no simple-icons mapping exists.
export function getLetterIcon(name) {
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  // Stable hue from the name so each provider's fallback has a distinct color.
  let hash = 0;
  for (const c of name || '') hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue} 50% 55%)`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${bg}"/><text x="12" y="16" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="600" font-size="13" fill="white">${ch}</text></svg>`,
    hex: bg,
    title: name,
  };
}
