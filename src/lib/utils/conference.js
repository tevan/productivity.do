const CONFERENCE_PATTERNS = [
  { name: 'Zoom', pattern: /https?:\/\/[\w.-]*zoom\.us\/j\/\S+/i },
  { name: 'Google Meet', pattern: /https?:\/\/meet\.google\.com\/[\w-]+/i },
  { name: 'Teams', pattern: /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+/i },
  { name: 'Webex', pattern: /https?:\/\/[\w.-]*webex\.com\/meet\/\S+/i },
];

export function detectConferenceUrl(event) {
  const texts = [event.location, event.description, event.conferenceUrl].filter(Boolean);
  const combined = texts.join(' ');

  for (const { pattern } of CONFERENCE_PATTERNS) {
    const match = combined.match(pattern);
    if (match) return match[0];
  }

  return null;
}

export function shouldShowJoinButton(event) {
  const url = detectConferenceUrl(event);
  if (!url) return false;

  const now = new Date();
  const start = new Date(event.start);
  const end = new Date(event.end);
  const fiveMinBefore = new Date(start.getTime() - 5 * 60 * 1000);

  return now >= fiveMinBefore && now <= end;
}
