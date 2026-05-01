import { google } from 'googleapis';
import { getDb } from '../db/init.js';

/**
 * Extract conference/video call URL from event description or location.
 * Matches Zoom, Google Meet, Microsoft Teams, and Webex URLs.
 */
export function extractConferenceUrl(text) {
  if (!text) return null;
  const patterns = [
    /https?:\/\/[\w.-]*zoom\.us\/[^\s"<>)]+/i,
    /https?:\/\/meet\.google\.com\/[^\s"<>)]+/i,
    /https?:\/\/teams\.microsoft\.com\/[^\s"<>)]+/i,
    /https?:\/\/[\w.-]*webex\.com\/[^\s"<>)]+/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Create an OAuth2 client with credentials from env.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Get an authenticated OAuth2 client with tokens from DB for a specific user.
 * Auto-refreshes expired access tokens.
 */
export function getAuthClient(userId) {
  if (!userId) throw new Error('getAuthClient requires userId');
  const db = getDb();
  const row = db.prepare('SELECT access_token, refresh_token, expiry FROM google_tokens WHERE user_id = ?').get(userId);
  if (!row) throw new Error('Google not connected');

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: new Date(row.expiry).getTime(),
  });

  // Listen for token refresh events and persist new tokens
  client.on('tokens', (tokens) => {
    const updates = {
      access_token: tokens.access_token || row.access_token,
      refresh_token: tokens.refresh_token || row.refresh_token,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : row.expiry,
    };
    db.prepare(`
      INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expiry = excluded.expiry,
        updated_at = datetime('now')
    `).run(userId, updates.access_token, updates.refresh_token, updates.expiry);
  });

  return client;
}

/**
 * Get the OAuth2 client for initiating the consent flow (no tokens needed).
 */
export function getOAuth2Client() {
  return createOAuth2Client();
}

/**
 * Store tokens in the DB after OAuth callback for a specific user.
 */
export function storeTokens(userId, tokens) {
  if (!userId) throw new Error('storeTokens requires userId');
  const db = getDb();
  db.prepare(`
    INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expiry = excluded.expiry,
      updated_at = datetime('now')
  `).run(
    userId,
    tokens.access_token,
    tokens.refresh_token || '',
    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : new Date(Date.now() + 3600000).toISOString()
  );
}

/**
 * Clear tokens from DB for a specific user.
 */
export function clearTokens(userId) {
  if (!userId) throw new Error('clearTokens requires userId');
  const db = getDb();
  db.prepare('DELETE FROM google_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sync_state WHERE user_id = ?').run(userId);
}

/**
 * Check if Google is connected (tokens exist) for a specific user.
 */
export function isConnected(userId) {
  if (!userId) throw new Error('isConnected requires userId');
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM google_tokens WHERE user_id = ?').get(userId);
  return !!row;
}

/**
 * List all calendars from Google Calendar API.
 */
export async function listCalendars(userId) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list();
  return res.data.items || [];
}

/**
 * List events for a calendar within a date range.
 */
export async function listEvents(userId, calendarId, timeMin, timeMax) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const events = [];
  let pageToken;

  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    if (res.data.items) events.push(...res.data.items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * Incremental sync using syncToken. Returns {events, nextSyncToken}.
 * If syncToken is invalid (410 Gone), returns null to signal full re-sync needed.
 */
export async function listEventsIncremental(userId, calendarId, syncToken) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const events = [];
    let pageToken;
    let nextSyncToken;

    do {
      const res = await calendar.events.list({
        calendarId,
        syncToken,
        pageToken,
      });
      if (res.data.items) events.push(...res.data.items);
      pageToken = res.data.nextPageToken;
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken };
  } catch (err) {
    if (err.code === 410) return null; // Full sync required
    throw err;
  }
}

/**
 * Create an event on Google Calendar.
 */
export async function createEvent(userId, calendarId, event) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });
  return res.data;
}

/**
 * Fetch a single event. Used to look up recurringEventId when editing
 * a recurrence instance.
 */
export async function getEvent(userId, calendarId, eventId) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}

/**
 * Update an event on Google Calendar.
 */
export async function updateEvent(userId, calendarId, eventId, event) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: event,
  });
  return res.data;
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteEvent(userId, calendarId, eventId) {
  const auth = getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId, eventId });
}
