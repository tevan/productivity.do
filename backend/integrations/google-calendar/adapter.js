// Google Calendar adapter — wraps the existing OAuth + sync flow in the
// adapter shape. The actual calendar/event sync logic still lives in
// backend/routes/calendar.js (incremental sync via Google's syncToken
// is non-trivial and isn't worth refactoring out of the route just for
// adapter neatness).
//
// Auth: OAuth 2.0 with refresh tokens, persisted in google_tokens table
// (the legacy table). We mirror the connected status into integrations
// so the new Settings UI can list it alongside other providers.

import * as google from '../../lib/google.js';
import { upsertIntegration, deleteIntegration } from '../store.js';

export const adapter = {
  provider: 'google_calendar',
  name: 'Google Calendar',
  kind: 'calendar',
  category: 'calendar',
  status: 'stable',
  recommended: true,
  authType: 'oauth',
  description: 'Two-way sync with Google Calendar — read events, create, update, delete.',
  docsUrl: 'https://developers.google.com/calendar',
  syncEnabled: true,
  requiresEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],

  async authStartUrl(userId, redirectUri) {
    // Existing /api/auth/google route owns this — kept here for the
    // generic auth flow but real users still hit the legacy route which
    // sets cookies the SPA expects.
    const oauth = google.getOAuth2Client();
    return oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ],
      redirect_uri: redirectUri,
    });
  },

  async authCallback(userId, code, redirectUri) {
    const oauth = google.getOAuth2Client();
    const { tokens } = await oauth.getToken({ code, redirect_uri: redirectUri });
    google.storeTokens(userId, tokens);
    upsertIntegration(userId, 'google_calendar', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      status: 'connected',
    });
    return { ok: true };
  },

  // Calendar sync runs out of routes/calendar.js#GET /api/events/sync —
  // not duplicated here. This is a no-op so the cron loop can still call it.
  async syncEvents(userId) {
    return { added: 0, updated: 0, deleted: 0, note: 'Google Calendar sync runs via /api/events/sync route' };
  },

  async createEvent(userId, calendarId, event) {
    return google.createEvent(userId, calendarId, event);
  },
  async updateEvent(userId, calendarId, eventId, event) {
    return google.updateEvent(userId, calendarId, eventId, event);
  },
  async deleteEvent(userId, calendarId, eventId) {
    return google.deleteEvent(userId, calendarId, eventId);
  },

  async disconnect(userId) {
    google.clearTokens(userId);
    deleteIntegration(userId, 'google_calendar');
    return { ok: true };
  },
};
