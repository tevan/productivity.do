// CalDAV adapter — covers iCloud, Fastmail, Nextcloud, ownCloud, Zimbra,
// most calendar servers in the wild. Auth is HTTP Basic (username +
// app-specific password). User provides:
//   - server URL (e.g. https://caldav.icloud.com)
//   - username (typically email)
//   - app-specific password (NOT their account password — providers all
//     require app-specific passwords for CalDAV)
//
// We use the `tsdav` library for spec-compliant CalDAV negotiation.
//
// API: RFC 4791. Implementations vary; tsdav handles the variation.

import { createDAVClient } from 'tsdav';
import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced, parseMetadata } from '../store.js';

async function client(userId) {
  const row = getIntegration(userId, 'caldav');
  if (!row?.access_token) throw new Error('CalDAV: not connected');
  const meta = parseMetadata(row);
  return createDAVClient({
    serverUrl: meta.serverUrl,
    credentials: {
      username: meta.username,
      password: row.access_token,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

export const adapter = {
  provider: 'caldav',
  name: 'CalDAV (iCloud, Fastmail, etc.)',
  kind: 'calendar',
  category: 'calendar',
  status: 'stable',
  recommended: false,
  authType: 'caldav',
  description: 'Connect any CalDAV-compatible calendar — iCloud, Fastmail, Nextcloud, and more.',
  docsUrl: 'https://support.apple.com/en-us/HT204397', // iCloud app-password instructions as a representative example
  syncEnabled: true,

  async authValidateCaldav(userId, { serverUrl, username, password }) {
    if (!serverUrl || !username || !password) {
      throw new Error('CalDAV: serverUrl, username, and password are required');
    }
    // Probe by creating a client and listing calendars. If it succeeds,
    // the credentials work.
    const probe = await createDAVClient({
      serverUrl,
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const cals = await probe.fetchCalendars();
    if (!cals.length) throw new Error('CalDAV: no calendars found at this server');
    upsertIntegration(userId, 'caldav', {
      access_token: password,           // app-specific password as bearer
      account_email: username,
      metadata_json: { serverUrl, username, calendarUrls: cals.map(c => c.url) },
    });
    return { ok: true, calendars: cals.map(c => ({ url: c.url, name: c.displayName })) };
  },

  async syncEvents(userId) {
    let added = 0, updated = 0;
    const upsert = q(`
      INSERT INTO events_cache
        (user_id, provider, calendar_id, google_event_id, summary, description, location,
         start_time, end_time, all_day, updated_at)
      VALUES (?, 'caldav', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(google_event_id) DO UPDATE SET
        provider = excluded.provider,
        calendar_id = excluded.calendar_id,
        summary = excluded.summary,
        description = excluded.description,
        location = excluded.location,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        all_day = excluded.all_day,
        updated_at = datetime('now')
    `);
    try {
      const c = await client(userId);
      const cals = await c.fetchCalendars();
      const start = new Date(Date.now() - 30 * 86400_000);
      const end = new Date(Date.now() + 90 * 86400_000);
      for (const cal of cals) {
        const objects = await c.fetchCalendarObjects({
          calendar: cal,
          timeRange: { start: start.toISOString(), end: end.toISOString() },
        });
        for (const obj of objects) {
          // Parse the iCalendar payload — minimal extraction. Full RRULE
          // expansion is out of scope for v1; surfacing the master event
          // is enough for most calendars.
          const ics = obj.data || '';
          const summary = (ics.match(/SUMMARY:(.*)/) || [, ''])[1].trim();
          const description = (ics.match(/DESCRIPTION:(.*)/) || [, ''])[1].trim();
          const location = (ics.match(/LOCATION:(.*)/) || [, ''])[1].trim();
          const dtStart = (ics.match(/DTSTART(?:;[^:]*)?:([^\r\n]+)/) || [, ''])[1].trim();
          const dtEnd = (ics.match(/DTEND(?:;[^:]*)?:([^\r\n]+)/) || [, ''])[1].trim();
          if (!dtStart) continue;
          const allDay = !dtStart.includes('T');
          const startIso = parseIcsDate(dtStart);
          const endIso = parseIcsDate(dtEnd) || startIso;
          const uid = (ics.match(/UID:(.*)/) || [, obj.url])[1].trim();
          const r = upsert.run(
            userId,
            cal.url,                          // calendar id = the CalDAV url
            `caldav_${uid}`,
            summary,
            description || null,
            location || null,
            startIso,
            endIso,
            allDay ? 1 : 0
          );
          if (r.changes === 1) added++; else updated++;
        }
      }
      markSynced(userId, 'caldav');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'caldav', e.message);
      throw e;
    }
  },

  // Write-back is non-trivial for CalDAV — building proper iCalendar
  // payloads with timezone handling is its own project. v1 is read-only.
  async createEvent() {
    const e = new Error('CalDAV write support not yet implemented (v1 is read-only).');
    e.code = 'unsupported';
    throw e;
  },
  async updateEvent() { return this.createEvent(); },
  async deleteEvent() { return this.createEvent(); },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) q("DELETE FROM events_cache WHERE user_id = ? AND provider = 'caldav'").run(userId);
    deleteIntegration(userId, 'caldav');
    return { ok: true };
  },
};

function parseIcsDate(s) {
  if (!s) return null;
  // YYYYMMDD or YYYYMMDDTHHMMSS[Z]
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return s;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`;
}
