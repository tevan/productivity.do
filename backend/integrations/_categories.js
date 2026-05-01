// Curated category list for the marketplace UI. Order matters — this is
// the order categories appear in the directory.
//
// `kind` (calendar/tasks/notes/...) is what an adapter *does* — it's what
// data it surfaces. `category` is what tool *family* it belongs to — it's
// what the marketplace browser groups by. They overlap but aren't the same.

export const CATEGORIES = [
  { id: 'calendar',        label: 'Calendar',           description: 'Two-way sync with calendar apps.' },
  { id: 'tasks',           label: 'Task management',    description: 'Tasks and projects.' },
  { id: 'notes',           label: 'Notes',              description: 'Personal knowledge bases.' },
  { id: 'email',           label: 'Email',              description: 'Inbox + email-to-task.' },
  { id: 'storage',         label: 'File storage',       description: 'Cloud drives — attach files to events, tasks, notes.' },
  { id: 'docs',            label: 'Documents',          description: 'Docs, Sheets, Slides, Office 365.' },
  { id: 'meetings',        label: 'Video meetings',     description: 'Generate meeting links from events.' },
  { id: 'communication',   label: 'Team communication', description: 'Notifications and channel posts.' },
  { id: 'time',            label: 'Time tracking',      description: 'Log time against tasks.' },
  { id: 'forms',           label: 'Forms',              description: 'Capture form responses as tasks or events.' },
  { id: 'whiteboards',     label: 'Whiteboards',        description: 'Embed boards into events and notes.' },
  { id: 'design',          label: 'Design',             description: 'Canva, Figma — create and link assets.' },
  { id: 'crm',             label: 'CRM & contacts',     description: 'Sales pipelines and people.' },
  { id: 'sms',             label: 'SMS & phone',        description: 'Send reminders by text.' },
  { id: 'automation',      label: 'Automation',         description: 'Zapier, Make, n8n.' },
  { id: 'ai',              label: 'AI providers',       description: 'LLMs that power prep summaries and NL features.' },
];

export const STATUS = {
  STABLE:      'stable',      // tested, in active use
  BETA:        'beta',        // wired but not battle-tested
  COMING_SOON: 'coming_soon', // stub only, surfaced for discoverability
  DEPRECATED:  'deprecated',  // we'll remove this in a future version
};
