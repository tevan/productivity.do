// Microsoft 365 Calendar adapter — Graph API. Shares OAuth tokens with
// Microsoft To Do — connecting one provider connects both. We probe both
// integrations table rows during sync and use whichever has a token.
//
// API: https://learn.microsoft.com/graph/api/resources/calendar

import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced } from '../store.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function token(userId) {
  const row = getIntegration(userId, 'microsoft_calendar')
    || getIntegration(userId, 'microsoft_todo');
  if (!row?.access_token) throw new Error('Microsoft: not connected');
  return row.access_token;
}

async function graph(userId, method, path, body) {
  const t = await token(userId);
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Microsoft Graph: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export const adapter = {
  provider: 'microsoft_calendar',
  name: 'Microsoft 365 Calendar',
  kind: 'calendar',
  category: 'calendar',
  status: 'stable',
  recommended: true,
  authType: 'oauth',
  description: 'Two-way sync with Outlook / Microsoft 365 calendar.',
  docsUrl: 'https://learn.microsoft.com/graph/api/resources/calendar',
  syncEnabled: true,
  requiresEnv: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],

  async authStartUrl(userId, redirectUri) {
    const clientId = process.env.MS_CLIENT_ID;
    if (!clientId) throw new Error('Microsoft: MS_CLIENT_ID not configured');
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'offline_access Calendars.ReadWrite Tasks.ReadWrite User.Read');
    url.searchParams.set('state', String(userId));
    return url.toString();
  },

  async authCallback(userId, code, redirectUri) {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft token exchange: ${await res.text()}`);
    const tokens = await res.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    // Write to BOTH provider rows so either adapter can use the tokens.
    for (const provider of ['microsoft_calendar', 'microsoft_todo']) {
      upsertIntegration(userId, provider, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      });
    }
    return { ok: true };
  },

  async syncEvents(userId) {
    let added = 0, updated = 0;
    const upsert = q(`
      INSERT INTO events_cache
        (user_id, provider, calendar_id, google_event_id, summary, description, location,
         start_time, end_time, all_day, updated_at)
      VALUES (?, 'microsoft_calendar', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      // -30d / +90d window matches what /api/events serves the SPA.
      const start = new Date(Date.now() - 30 * 86400_000).toISOString();
      const end = new Date(Date.now() + 90 * 86400_000).toISOString();
      const url = `/me/calendarview?startDateTime=${start}&endDateTime=${end}&$top=100`;
      const events = await graph(userId, 'GET', url);
      for (const e of (events.value || [])) {
        const startIso = e.start?.dateTime || e.start?.date;
        const endIso = e.end?.dateTime || e.end?.date;
        if (!startIso || !endIso) continue;
        const r = upsert.run(
          userId,
          'ms_calendar',                          // single virtual calendar id for now
          `ms_${e.id}`,
          e.subject || '',
          e.bodyPreview || null,
          e.location?.displayName || null,
          startIso,
          endIso,
          e.isAllDay ? 1 : 0
        );
        if (r.changes === 1) added++; else updated++;
      }
      markSynced(userId, 'microsoft_calendar');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'microsoft_calendar', e.message);
      throw e;
    }
  },

  async createEvent(userId, calendarId, event) {
    return graph(userId, 'POST', '/me/events', {
      subject: event.summary,
      body: event.description ? { contentType: 'text', content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: { dateTime: event.start, timeZone: event.timeZone || 'UTC' },
      end: { dateTime: event.end, timeZone: event.timeZone || 'UTC' },
      isAllDay: !!event.allDay,
    });
  },
  async updateEvent(userId, calendarId, eventId, event) {
    const id = eventId.replace(/^ms_/, '');
    return graph(userId, 'PATCH', `/me/events/${id}`, {
      ...(event.summary != null ? { subject: event.summary } : {}),
      ...(event.start ? { start: { dateTime: event.start, timeZone: event.timeZone || 'UTC' } } : {}),
      ...(event.end ? { end: { dateTime: event.end, timeZone: event.timeZone || 'UTC' } } : {}),
    });
  },
  async deleteEvent(userId, calendarId, eventId) {
    const id = eventId.replace(/^ms_/, '');
    await graph(userId, 'DELETE', `/me/events/${id}`);
    return { ok: true };
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) {
      q("DELETE FROM events_cache WHERE user_id = ? AND provider = 'microsoft_calendar'").run(userId);
    }
    deleteIntegration(userId, 'microsoft_calendar');
    // Also clear the linked microsoft_todo connection if user wants a clean break.
    return { ok: true };
  },
};
