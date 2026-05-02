/**
 * Email + outbound webhook helpers for booking notifications.
 *
 * Email backend: Resend (if RESEND_API_KEY is set). All sends are best-effort:
 * the booking still confirms even if email fails.
 *
 * Workflow webhooks: simple POST with a JSON body (or a templated body).
 */

import { buildIcs, googleCalendarUrl, outlookUrl } from './ics.js';
import { getDb } from '../db/init.js';
import { captureError } from './sentry.js';

function fmtWhen(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

function publicOrigin() {
  return process.env.PUBLIC_ORIGIN || 'https://productivity.do';
}

/**
 * Send the email-verification message after signup. Best-effort like the rest.
 */
export async function sendVerificationEmail({ to, token }) {
  const link = `${publicOrigin()}/api/verify/${token}`;
  return resendSend({
    to,
    subject: 'Verify your Productivity account',
    html: `
      <p>Welcome to Productivity!</p>
      <p>Confirm your email to finish setting up your account:</p>
      <p><a href="${link}" style="display: inline-block; background: #3b82f6; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Verify email</a></p>
      <p style="font-size: 13px; color: #6b7280;">Or copy this link: ${link}</p>
      <p style="font-size: 12px; color: #9ca3af;">If you didn't create an account, ignore this email.</p>
    `,
  });
}

// Lower-level helper. Exported so account/security flows can send simple
// transactional emails without going through a templated wrapper.
export async function resendSend({ to, subject, html, text, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_api_key' };
  const from = process.env.RESEND_FROM || 'Productivity <bookings@productivity.do>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from, to, subject, html, text,
        attachments: attachments || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    console.warn('Resend send failed:', err.message);
    captureError(err, { component: 'notify.resend', to, subject });
    return { ok: false, reason: err.message };
  }
}

function renderConfirmationEmail({ page, booking, eventType }) {
  const when = fmtWhen(booking.start_iso, booking.timezone || page.timezone || 'UTC');
  const title = (eventType?.title) || page.title;
  const cancelUrl = `${publicOrigin()}/book/cancel/${booking.cancel_token}`;
  const rescheduleUrl = `${publicOrigin()}/book/reschedule/${booking.reschedule_token}`;
  const gcal = googleCalendarUrl({
    summary: title,
    description: page.description || '',
    start: booking.start_iso,
    end: booking.end_iso,
    location: page.location_value || '',
  });
  const out = outlookUrl({
    summary: title,
    description: page.description || '',
    start: booking.start_iso,
    end: booking.end_iso,
    location: page.location_value || '',
  });
  const lines = [];
  lines.push(`<p>Hi ${escapeHtml(booking.invitee_name)},</p>`);
  lines.push(`<p>You're confirmed for <strong>${escapeHtml(title)}</strong>.</p>`);
  lines.push(`<p style="font-size: 18px; color: #6366f1; font-weight: 500;">${escapeHtml(when)}</p>`);
  if (page.location_type === 'video') {
    lines.push(`<p>A Google Meet link has been added to your calendar invite.</p>`);
  } else if (page.location_value) {
    lines.push(`<p>Where: ${escapeHtml(page.location_value)}</p>`);
  }
  if (page.description) {
    lines.push(`<p style="color: #4b5563;">${escapeHtml(page.description)}</p>`);
  }
  lines.push('<p style="margin-top: 24px;">');
  lines.push(`<a href="${gcal}" style="margin-right: 12px;">Add to Google Calendar</a> · `);
  lines.push(`<a href="${out}" style="margin-right: 12px;">Add to Outlook</a>`);
  lines.push('</p>');
  lines.push('<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">');
  lines.push(`<p style="font-size: 13px; color: #6b7280;">Need to make a change?<br>`);
  lines.push(`<a href="${rescheduleUrl}">Reschedule</a> · <a href="${cancelUrl}">Cancel</a></p>`);
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function sendBookingConfirmation({ page, booking, eventType, hostName, hostEmail }) {
  if (!page.send_emails) return { ok: false, reason: 'disabled' };
  const html = renderConfirmationEmail({ page, booking, eventType });
  const ics = page.enable_ics ? buildIcs({
    uid: booking.id,
    summary: eventType?.title || page.title,
    description: page.description || '',
    start: booking.start_iso,
    end: booking.end_iso,
    location: page.location_value,
    organizer: hostEmail ? { name: hostName || page.host_name, email: hostEmail } : null,
    attendee: { name: booking.invitee_name, email: booking.invitee_email },
    url: `${publicOrigin()}/book/${page.slug}`,
  }) : null;
  return resendSend({
    to: booking.invitee_email,
    subject: `Confirmed: ${eventType?.title || page.title}`,
    html,
    attachments: ics ? [{
      filename: 'invite.ics',
      content: Buffer.from(ics).toString('base64'),
      content_type: 'text/calendar; charset=utf-8',
    }] : undefined,
  });
}

export async function sendBookingCancellation({ page, booking, reason }) {
  if (!page.send_emails) return { ok: false, reason: 'disabled' };
  const when = fmtWhen(booking.start_iso, booking.timezone || page.timezone || 'UTC');
  const html = `
    <p>Hi ${escapeHtml(booking.invitee_name)},</p>
    <p>Your booking for <strong>${escapeHtml(page.title)}</strong> on <strong>${escapeHtml(when)}</strong> has been cancelled.</p>
    ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
    <p>You're welcome to <a href="${publicOrigin()}/book/${page.slug}">book another time</a> if you'd like.</p>
  `;
  return resendSend({
    to: booking.invitee_email,
    subject: `Cancelled: ${page.title}`,
    html,
  });
}

/**
 * Sweep all confirmed bookings due in ~24 hours and send reminders.
 * Idempotent — sets reminder_sent_at after each send so we never double-send.
 * Call from a setInterval at server startup.
 */
export async function processReminderSweep(getDb, fireWorkflowsFn) {
  try {
    const db = getDb();
    const now = Date.now();
    const lower = new Date(now + 23 * 3600 * 1000).toISOString();
    const upper = new Date(now + 25 * 3600 * 1000).toISOString();
    const due = db.prepare(`
      SELECT b.*, p.title AS p_title, p.timezone AS p_tz, p.send_emails AS p_send_emails,
             p.reminder_24h AS p_reminder_24h, p.user_id AS p_user_id, p.id AS p_id, p.slug AS p_slug
      FROM bookings b
      JOIN booking_pages p ON p.id = b.page_id
      WHERE b.status = 'confirmed'
        AND b.reminder_sent_at IS NULL
        AND b.start_iso BETWEEN ? AND ?
        AND p.reminder_24h = 1
      LIMIT 200
    `).all(lower, upper);

    for (const row of due) {
      const eventType = row.type_id
        ? db.prepare('SELECT * FROM event_types WHERE id = ?').get(row.type_id)
        : null;
      const page = {
        title: row.p_title,
        timezone: row.p_tz,
        send_emails: row.p_send_emails,
        reminder_24h: row.p_reminder_24h,
        user_id: row.p_user_id,
        id: row.p_id,
        slug: row.p_slug,
      };
      // Best-effort: don't crash the sweep on a single failure.
      try {
        await sendReminder24h({ page, booking: row, eventType });
      } catch (err) {
        console.warn(`reminder for booking ${row.id} failed:`, err.message);
        captureError(err, { component: 'notify.reminder24h', bookingId: row.id });
      }
      // Fire workflow webhooks for this trigger as well.
      if (fireWorkflowsFn) {
        try {
          const wfs = db.prepare('SELECT * FROM booking_workflows WHERE page_id = ? AND is_active = 1 AND trigger = ?').all(row.page_id, 'reminder_24h');
          await fireWorkflowsFn(wfs, 'reminder_24h', {
            page: { slug: row.p_slug, title: row.p_title },
            booking: {
              id: row.id, name: row.invitee_name, email: row.invitee_email,
              startIso: row.start_iso, endIso: row.end_iso,
            },
          });
        } catch {}
      }
      // Mark as sent regardless of email success — we don't want to retry failed
      // emails repeatedly and spam if Resend has a transient failure.
      db.prepare('UPDATE bookings SET reminder_sent_at = datetime(\'now\') WHERE id = ?').run(row.id);
    }
    return { processed: due.length };
  } catch (err) {
    console.warn('reminder sweep failed:', err.message);
    captureError(err, { component: 'notify.reminderSweep' });
    return { processed: 0, error: err.message };
  }
}

export async function sendReminder24h({ page, booking, eventType }) {
  if (!page.send_emails || !page.reminder_24h) return { ok: false, reason: 'disabled' };
  const when = fmtWhen(booking.start_iso, booking.timezone || page.timezone || 'UTC');
  const html = `
    <p>Hi ${escapeHtml(booking.invitee_name)},</p>
    <p>Quick reminder — your meeting is tomorrow:</p>
    <p style="font-size: 18px; color: #6366f1; font-weight: 500;">${escapeHtml(when)}</p>
    <p><strong>${escapeHtml(eventType?.title || page.title)}</strong></p>
    <p style="font-size: 13px; color: #6b7280;">
      <a href="${publicOrigin()}/book/cancel/${booking.cancel_token}">Cancel</a> ·
      <a href="${publicOrigin()}/book/reschedule/${booking.reschedule_token}">Reschedule</a>
    </p>
  `;
  return resendSend({
    to: booking.invitee_email,
    subject: `Reminder: ${eventType?.title || page.title} tomorrow`,
    html,
  });
}

const WORKFLOW_TIMEOUT_MS = 8_000;

/**
 * SSRF guard: reject anything that isn't an https:// URL pointing to a public
 * hostname. Block loopback, link-local, and RFC1918 ranges so a workflow
 * URL can't be aimed at our own internal services.
 */
export function isSafeWebhookUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  // IPv4 literal?
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10) return false;                                    // 10.0.0.0/8
    if (a === 127) return false;                                   // loopback
    if (a === 169 && b === 254) return false;                      // link-local
    if (a === 172 && b >= 16 && b <= 31) return false;             // 172.16/12
    if (a === 192 && b === 168) return false;                      // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return false;            // CGNAT
    if (a === 0 || a >= 224) return false;                         // 0.0.0.0/8 + multicast/reserved
  }
  // Common IPv6 internal prefixes
  if (host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return false;
  return true;
}

/**
 * Fire workflow webhooks for a trigger. Skips inactive workflows. Best-effort.
 * Each call is bounded by WORKFLOW_TIMEOUT_MS and SSRF-checked before dispatch.
 */
export async function fireWorkflows(workflows, trigger, payload) {
  const matching = (workflows || []).filter(w => w.is_active && w.trigger === trigger);
  await Promise.all(matching.map(async (w) => {
    if (!isSafeWebhookUrl(w.webhook_url)) {
      console.warn(`workflow ${w.id} skipped: unsafe URL`);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);
    try {
      const body = w.body_template ? renderTemplate(w.body_template, payload) : JSON.stringify(payload);
      const res = await fetch(w.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`workflow ${w.id} returned ${res.status}`);
      }
    } catch (err) {
      console.warn(`workflow ${w.id} failed:`, err.message);
      captureError(err, { component: 'notify.workflow', workflowId: w.id, trigger });
    } finally {
      clearTimeout(timer);
    }
  }));
}

function renderTemplate(template, vars) {
  // Replace {{path.to.var}} with values from vars; ignore unknown.
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const parts = path.split('.');
    let cur = vars;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    return String(cur ?? '');
  });
}

// ---------------------------------------------------------------------------
// User-channel notifications (email + SMS)
//
// Called by emitEvent() in webhooks.js to fan out a single notification
// across the user's enabled channels. Both helpers are best-effort:
// failures log but never throw — notifications are advisory and shouldn't
// break the originating action.
// ---------------------------------------------------------------------------

export async function sendUserEmail({ userId, subject, body }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: 'resend_not_configured' };
  try {
    const row = getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!row?.email) return { ok: false, reason: 'no_email' };
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; padding: 20px;">
        <h2 style="font-size: 18px; margin: 0 0 12px;">${escapeHtml(subject)}</h2>
        <p style="font-size: 14px; line-height: 1.5; color: #374151; white-space: pre-wrap;">${escapeHtml(body)}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">
          Adjust which notifications you receive in
          <a href="${publicOrigin()}/" style="color: #3b82f6;">Settings → Notifications</a>.
        </p>
      </div>
    `;
    return await resendSend({ to: row.email, subject, html, text: body });
  } catch (err) {
    console.warn('sendUserEmail failed:', err.message);
    captureError(err, { component: 'notify.userEmail', userId });
    return { ok: false, reason: err.message };
  }
}

// SMS via Twilio. Requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN +
// TWILIO_FROM_NUMBER. Without them this no-ops silently — the UI still
// lets the user opt in, the dispatch just doesn't fire.
export async function sendUserSms({ to, message }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !auth || !from) return { ok: false, reason: 'twilio_not_configured' };
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: from, Body: message });
    const basic = Buffer.from(`${sid}:${auth}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    console.warn('sendUserSms failed:', err.message);
    captureError(err, { component: 'notify.userSms' });
    return { ok: false, reason: err.message };
  }
}

// (escapeHtml defined earlier in this file — reuse.)

