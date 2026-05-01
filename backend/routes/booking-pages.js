import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/init.js';
import {
  defaultAvailability,
  slugify,
  randomSlugFragment,
  randomToken,
} from '../lib/booking.js';
import {
  rowToPage,
  rowToEventType,
  rowToQuestion,
  rowToWorkflow,
} from '../lib/bookingMappers.js';
import { isSafeWebhookUrl, sendBookingConfirmation } from '../lib/notify.js';
import { checkCountLimit, getLimits } from '../lib/plans.js';
import { emitEvent } from '../lib/webhooks.js';
import * as google from '../lib/google.js';

const router = Router();

function validateStrategy(s) {
  return ['single', 'round_robin', 'collective'].includes(s) ? s : 'single';
}

function uuid() {
  return randomUUID();
}

// Returns the page row only if it belongs to the given user; otherwise null.
function getOwnedPage(db, pageId, userId) {
  return db.prepare('SELECT * FROM booking_pages WHERE id = ? AND user_id = ?').get(pageId, userId);
}

function ensureUniqueSlug(db, baseSlug, ignoreId = null) {
  let slug = baseSlug;
  for (let i = 0; i < 9; i++) {
    const existing = db.prepare('SELECT id FROM booking_pages WHERE slug = ?').get(slug);
    if (!existing || (ignoreId && existing.id === ignoreId)) return slug;
    slug = `${baseSlug}-${randomSlugFragment()}`;
  }
  return `${baseSlug}-${Date.now().toString(36)}`;
}

function ensureUniqueTypeSlug(db, pageId, baseSlug, ignoreId = null) {
  let slug = baseSlug;
  for (let i = 0; i < 9; i++) {
    const existing = db.prepare('SELECT id FROM event_types WHERE page_id = ? AND slug = ?').get(pageId, slug);
    if (!existing || (ignoreId && existing.id === ignoreId)) return slug;
    slug = `${baseSlug}-${randomSlugFragment()}`;
  }
  return `${baseSlug}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// PAGES — list / create / read / update / delete
// ---------------------------------------------------------------------------

router.get('/api/booking-pages', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM booking_pages WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    if (rows.length === 0) return res.json({ ok: true, pages: [] });

    // Bulk-load sub-resources in 3 queries instead of 3 per page (N+1).
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const allTypes = db.prepare(
      `SELECT * FROM event_types WHERE page_id IN (${placeholders}) ORDER BY sort_order, created_at`
    ).all(...ids);
    const allQuestions = db.prepare(
      `SELECT * FROM custom_questions WHERE page_id IN (${placeholders}) AND type_id IS NULL ORDER BY sort_order`
    ).all(...ids);
    const allWorkflows = db.prepare(
      `SELECT * FROM booking_workflows WHERE page_id IN (${placeholders})`
    ).all(...ids);

    const groupBy = (arr, key) => {
      const m = new Map();
      for (const x of arr) {
        const k = x[key];
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(x);
      }
      return m;
    };
    const typesByPage = groupBy(allTypes, 'page_id');
    const questionsByPage = groupBy(allQuestions, 'page_id');
    const workflowsByPage = groupBy(allWorkflows, 'page_id');

    const pages = rows.map(r => ({
      ...rowToPage(r),
      eventTypes: (typesByPage.get(r.id) || []).map(rowToEventType),
      questions: (questionsByPage.get(r.id) || []).map(rowToQuestion),
      workflows: (workflowsByPage.get(r.id) || []).map(rowToWorkflow),
    }));
    res.json({ ok: true, pages });
  } catch (err) {
    console.error('GET /api/booking-pages:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/booking-pages', (req, res) => {
  try {
    const db = getDb();
    const body = req.body || {};

    // Plan-based limit: Free can create only 1 booking page.
    const currentCount = db.prepare('SELECT COUNT(*) as n FROM booking_pages WHERE user_id = ?').get(req.user.id).n;
    const limit = checkCountLimit(req.user.id, 'bookingPagesMax', currentCount);
    if (limit) return res.status(402).json(limit);

    const id = uuid();
    const baseSlug = slugify(body.slug || body.title || 'meet');
    const slug = ensureUniqueSlug(db, baseSlug);
    const availability = body.availability || defaultAvailability();
    db.prepare(`
      INSERT INTO booking_pages (
        id, slug, title, description,
        duration_min, buffer_before_min, buffer_after_min,
        location_type, location_value, color, is_active,
        calendar_id, check_calendar_ids,
        min_notice_min, max_advance_days, daily_max, slot_step_min,
        availability_json, timezone,
        require_phone, custom_question, redirect_url,
        host_name, host_email, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, slug,
      body.title || 'New booking page',
      body.description || null,
      body.durationMin || 30,
      body.bufferBeforeMin || 0,
      body.bufferAfterMin || 0,
      body.locationType || 'video',
      body.locationValue || null,
      body.color || null,
      body.isActive === false ? 0 : 1,
      body.calendarId || null,
      JSON.stringify(body.checkCalendarIds || []),
      body.minNoticeMin ?? 60,
      body.maxAdvanceDays ?? 60,
      body.dailyMax ?? null,
      body.slotStepMin || 30,
      JSON.stringify(availability),
      body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      body.requirePhone ? 1 : 0,
      body.customQuestion || null,
      body.redirectUrl || null,
      body.hostName || null,
      body.hostEmail || null,
      req.user.id
    );
    const row = db.prepare('SELECT * FROM booking_pages WHERE id = ?').get(id);
    res.json({ ok: true, page: rowToPage(row) });
  } catch (err) {
    console.error('POST /api/booking-pages:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/booking-pages/:id', (req, res) => {
  try {
    const db = getDb();
    const row = getOwnedPage(db, req.params.id, req.user.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    const types = db.prepare('SELECT * FROM event_types WHERE page_id = ? ORDER BY sort_order, created_at').all(row.id);
    const questions = db.prepare('SELECT * FROM custom_questions WHERE page_id = ? ORDER BY sort_order').all(row.id);
    const workflows = db.prepare('SELECT * FROM booking_workflows WHERE page_id = ?').all(row.id);
    res.json({
      ok: true,
      page: {
        ...rowToPage(row),
        eventTypes: types.map(rowToEventType),
        questions: questions.map(rowToQuestion),
        workflows: workflows.map(rowToWorkflow),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/api/booking-pages/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = getOwnedPage(db, req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
    const body = req.body || {};
    let slug = existing.slug;
    if (body.slug && body.slug !== slug) {
      slug = ensureUniqueSlug(db, slugify(body.slug), req.params.id);
    }
    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      duration_min: body.durationMin ?? existing.duration_min,
      buffer_before_min: body.bufferBeforeMin ?? existing.buffer_before_min,
      buffer_after_min: body.bufferAfterMin ?? existing.buffer_after_min,
      location_type: body.locationType ?? existing.location_type,
      location_value: body.locationValue ?? existing.location_value,
      color: body.color ?? existing.color,
      brand_color: body.brandColor ?? existing.brand_color,
      logo_url: body.logoUrl ?? existing.logo_url,
      cover_image_url: body.coverImageUrl ?? existing.cover_image_url,
      is_active: body.isActive === undefined ? existing.is_active : (body.isActive ? 1 : 0),
      calendar_id: body.calendarId ?? existing.calendar_id,
      check_calendar_ids: body.checkCalendarIds ? JSON.stringify(body.checkCalendarIds) : existing.check_calendar_ids,
      min_notice_min: body.minNoticeMin ?? existing.min_notice_min,
      max_advance_days: body.maxAdvanceDays ?? existing.max_advance_days,
      daily_max: body.dailyMax === undefined ? existing.daily_max : body.dailyMax,
      min_gap_min: body.minGapMin ?? existing.min_gap_min ?? 0,
      weekly_max: body.weeklyMax === undefined ? existing.weekly_max : body.weeklyMax,
      slot_step_min: body.slotStepMin ?? existing.slot_step_min,
      availability_json: body.availability ? JSON.stringify(body.availability) : existing.availability_json,
      timezone: body.timezone ?? existing.timezone,
      require_phone: body.requirePhone === undefined ? existing.require_phone : (body.requirePhone ? 1 : 0),
      custom_question: body.customQuestion ?? existing.custom_question,
      redirect_url: body.redirectUrl ?? existing.redirect_url,
      host_name: body.hostName ?? existing.host_name,
      host_email: body.hostEmail ?? existing.host_email,
      has_event_types: body.hasEventTypes === undefined ? existing.has_event_types : (body.hasEventTypes ? 1 : 0),
      enable_ics: body.enableIcs === undefined ? existing.enable_ics : (body.enableIcs ? 1 : 0),
      send_emails: body.sendEmails === undefined ? existing.send_emails : (body.sendEmails ? 1 : 0),
      reminder_24h: body.reminder24h === undefined ? existing.reminder_24h : (body.reminder24h ? 1 : 0),
      assignment_strategy: validateStrategy(body.assignmentStrategy ?? existing.assignment_strategy),
      host_user_ids: body.hostUserIds !== undefined
        ? JSON.stringify(Array.isArray(body.hostUserIds) ? body.hostUserIds.filter(x => Number.isFinite(Number(x))).map(Number) : [])
        : existing.host_user_ids,
    };

    // Gate Team booking behind a plan with teamFeatures.
    if (merged.assignment_strategy !== 'single' && !getLimits(req.user.id).teamFeatures) {
      return res.status(402).json({
        ok: false,
        error: 'Round-robin and collective booking require the Team plan.',
        code: 'plan_required',
      });
    }
    db.prepare(`
      UPDATE booking_pages SET
        slug = ?,
        title = ?, description = ?,
        duration_min = ?, buffer_before_min = ?, buffer_after_min = ?,
        location_type = ?, location_value = ?, color = ?,
        brand_color = ?, logo_url = ?, cover_image_url = ?,
        is_active = ?,
        calendar_id = ?, check_calendar_ids = ?,
        min_notice_min = ?, max_advance_days = ?, daily_max = ?,
        min_gap_min = ?, weekly_max = ?,
        slot_step_min = ?,
        availability_json = ?, timezone = ?,
        require_phone = ?, custom_question = ?, redirect_url = ?,
        host_name = ?, host_email = ?,
        has_event_types = ?, enable_ics = ?, send_emails = ?, reminder_24h = ?,
        assignment_strategy = ?, host_user_ids = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      slug,
      merged.title, merged.description,
      merged.duration_min, merged.buffer_before_min, merged.buffer_after_min,
      merged.location_type, merged.location_value, merged.color,
      merged.brand_color, merged.logo_url, merged.cover_image_url,
      merged.is_active,
      merged.calendar_id, merged.check_calendar_ids,
      merged.min_notice_min, merged.max_advance_days, merged.daily_max,
      merged.min_gap_min, merged.weekly_max,
      merged.slot_step_min,
      merged.availability_json, merged.timezone,
      merged.require_phone, merged.custom_question, merged.redirect_url,
      merged.host_name, merged.host_email,
      merged.has_event_types, merged.enable_ics, merged.send_emails, merged.reminder_24h,
      merged.assignment_strategy, merged.host_user_ids,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM booking_pages WHERE id = ?').get(req.params.id);
    res.json({ ok: true, page: rowToPage(row) });
  } catch (err) {
    console.error('PUT /api/booking-pages/:id:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/booking-pages/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM booking_pages WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/booking-pages/:id/bookings', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const rows = db.prepare(`
      SELECT * FROM bookings WHERE page_id = ? ORDER BY start_iso DESC LIMIT 200
    `).all(req.params.id);
    res.json({ ok: true, bookings: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CSV export of bookings
// ---------------------------------------------------------------------------
router.get('/api/booking-pages/:id/bookings.csv', (req, res) => {
  const db = getDb();
  if (!getOwnedPage(db, req.params.id, req.user.id)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const rows = db.prepare(`
    SELECT b.*, et.title AS type_title, et.price_cents, et.price_currency
    FROM bookings b LEFT JOIN event_types et ON et.id = b.type_id
    WHERE b.page_id = ?
    ORDER BY b.start_iso DESC
  `).all(req.params.id);

  const headers = [
    'id', 'created_at', 'status', 'type', 'invitee_name', 'invitee_email', 'invitee_phone',
    'start', 'end', 'timezone', 'message', 'no_show', 'payment_status', 'price_cents', 'price_currency',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.created_at, r.status, r.type_title || '', r.invitee_name || '',
      r.invitee_email || '', r.invitee_phone || '',
      r.start_iso, r.end_iso, r.timezone || '',
      r.message || '', r.no_show ? '1' : '0',
      r.payment_status || '', r.price_cents || '', r.price_currency || '',
    ].map(csvEscape).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="bookings-${req.params.id}.csv"`);
  res.send(lines.join('\r\n') + '\r\n');
});

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// ANALYTICS — bookings/week, conversion, no-show rate, revenue
// Optional ?days=30|90|365 (default 30)
// ---------------------------------------------------------------------------
router.get('/api/booking-pages/:id/analytics', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const days = Math.max(7, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const sinceDay = since.slice(0, 10);

    // Pageviews (sum + by-day series)
    const viewsTotal = db.prepare(
      'SELECT COALESCE(SUM(views), 0) AS n FROM booking_page_views WHERE page_id = ? AND day >= ?'
    ).get(req.params.id, sinceDay).n;
    const viewsByDay = db.prepare(
      'SELECT day, views FROM booking_page_views WHERE page_id = ? AND day >= ? ORDER BY day'
    ).all(req.params.id, sinceDay);

    // Bookings (counts by status + by-day series of created bookings)
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) AS n FROM bookings
      WHERE page_id = ? AND created_at >= ?
      GROUP BY status
    `).all(req.params.id, since);
    const bookingsByDay = db.prepare(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
      FROM bookings
      WHERE page_id = ? AND created_at >= ?
      GROUP BY day ORDER BY day
    `).all(req.params.id, since);

    // No-show count — only bookings whose start has passed.
    const noShows = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
      WHERE page_id = ? AND no_show = 1 AND start_iso <= datetime('now') AND start_iso >= ?
    `).get(req.params.id, since).n;
    const completedPast = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
      WHERE page_id = ? AND status = 'confirmed'
        AND start_iso <= datetime('now') AND start_iso >= ?
    `).get(req.params.id, since).n;

    // Revenue (cents) from paid bookings.
    const revenue = db.prepare(`
      SELECT COALESCE(SUM(et.price_cents), 0) AS cents, COALESCE(et.price_currency, 'USD') AS currency
      FROM bookings b
      LEFT JOIN event_types et ON et.id = b.type_id
      WHERE b.page_id = ? AND b.payment_status = 'paid' AND b.created_at >= ?
      GROUP BY currency
    `).all(req.params.id, since);

    const totalBookings = statusCounts.reduce((a, r) => a + r.n, 0);
    const confirmedBookings = (statusCounts.find(r => r.status === 'confirmed')?.n) || 0;

    res.json({
      ok: true,
      windowDays: days,
      summary: {
        views: viewsTotal,
        bookings: totalBookings,
        confirmed: confirmedBookings,
        canceled: (statusCounts.find(r => r.status === 'canceled')?.n) || 0,
        // Conversion: confirmed bookings / page views in window. Null if 0 views.
        conversionRate: viewsTotal > 0 ? confirmedBookings / viewsTotal : null,
        noShows,
        // Of past confirmed bookings, what fraction got marked no-show.
        noShowRate: completedPast > 0 ? noShows / completedPast : null,
        revenue: revenue.map(r => ({ cents: r.cents, currency: r.currency })),
      },
      series: {
        views: viewsByDay,
        bookings: bookingsByDay,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Mark a booking as no-show (or clear). Owner-scoped.
// PUT /api/bookings/:id  Body: { noShow: true|false }
// ---------------------------------------------------------------------------
router.put('/api/bookings/:id', (req, res) => {
  try {
    const db = getDb();
    // Verify ownership through the page join.
    const row = db.prepare(`
      SELECT b.id, b.page_id, p.user_id FROM bookings b
      JOIN booking_pages p ON p.id = b.page_id
      WHERE b.id = ?
    `).get(req.params.id);
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const { noShow } = req.body || {};
    if (noShow === undefined) {
      return res.status(400).json({ ok: false, error: 'No-op' });
    }
    db.prepare(
      "UPDATE bookings SET no_show = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(noShow ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// EVENT TYPES — sub-resource of a page
// ---------------------------------------------------------------------------

router.post('/api/booking-pages/:id/event-types', (req, res) => {
  try {
    const db = getDb();
    const page = getOwnedPage(db, req.params.id, req.user.id);
    if (!page) return res.status(404).json({ ok: false, error: 'Page not found' });
    const body = req.body || {};
    const id = uuid();
    const slug = ensureUniqueTypeSlug(db, req.params.id, slugify(body.slug || body.title || 'type'));
    db.prepare(`
      INSERT INTO event_types (
        id, page_id, title, slug, description, duration_min,
        buffer_before_min, buffer_after_min,
        location_type, location_value, color, capacity, is_active, sort_order,
        price_cents, price_currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.params.id,
      body.title || 'Untitled type',
      slug,
      body.description || null,
      body.durationMin || 30,
      body.bufferBeforeMin || 0,
      body.bufferAfterMin || 0,
      body.locationType || null,
      body.locationValue || null,
      body.color || null,
      body.capacity || 1,
      body.isActive === false ? 0 : 1,
      body.sortOrder || 0,
      body.priceCents || null,
      body.priceCurrency || null,
    );
    db.prepare('UPDATE booking_pages SET has_event_types = 1, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM event_types WHERE id = ?').get(id);
    res.json({ ok: true, eventType: rowToEventType(row) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/api/booking-pages/:id/event-types/:typeId', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const existing = db.prepare('SELECT * FROM event_types WHERE id = ? AND page_id = ?').get(req.params.typeId, req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
    const b = req.body || {};
    let slug = existing.slug;
    if (b.slug && b.slug !== slug) {
      slug = ensureUniqueTypeSlug(db, req.params.id, slugify(b.slug), req.params.typeId);
    }
    db.prepare(`
      UPDATE event_types SET
        title = ?, slug = ?, description = ?, duration_min = ?,
        buffer_before_min = ?, buffer_after_min = ?,
        location_type = ?, location_value = ?, color = ?, capacity = ?,
        is_active = ?, sort_order = ?, price_cents = ?, price_currency = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title ?? existing.title,
      slug,
      b.description ?? existing.description,
      b.durationMin ?? existing.duration_min,
      b.bufferBeforeMin ?? existing.buffer_before_min,
      b.bufferAfterMin ?? existing.buffer_after_min,
      b.locationType ?? existing.location_type,
      b.locationValue ?? existing.location_value,
      b.color ?? existing.color,
      b.capacity ?? existing.capacity,
      b.isActive === undefined ? existing.is_active : (b.isActive ? 1 : 0),
      b.sortOrder ?? existing.sort_order,
      b.priceCents === undefined ? existing.price_cents : b.priceCents,
      b.priceCurrency ?? existing.price_currency,
      req.params.typeId
    );
    const row = db.prepare('SELECT * FROM event_types WHERE id = ?').get(req.params.typeId);
    res.json({ ok: true, eventType: rowToEventType(row) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/booking-pages/:id/event-types/:typeId', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    db.prepare('DELETE FROM event_types WHERE id = ? AND page_id = ?').run(req.params.typeId, req.params.id);
    const remaining = db.prepare('SELECT COUNT(*) as n FROM event_types WHERE page_id = ?').get(req.params.id);
    if (remaining.n === 0) {
      db.prepare('UPDATE booking_pages SET has_event_types = 0 WHERE id = ?').run(req.params.id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CUSTOM QUESTIONS — sub-resource of a page
// ---------------------------------------------------------------------------

router.put('/api/booking-pages/:id/questions', (req, res) => {
  try {
    const db = getDb();
    const page = getOwnedPage(db, req.params.id, req.user.id);
    if (!page) return res.status(404).json({ ok: false, error: 'Page not found' });
    const list = Array.isArray(req.body?.questions) ? req.body.questions : [];

    const tx = db.transaction((items) => {
      db.prepare('DELETE FROM custom_questions WHERE page_id = ? AND type_id IS NULL').run(req.params.id);
      const insert = db.prepare(`
        INSERT INTO custom_questions (id, page_id, type_id, label, field_type, required, options_json, sort_order)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
      `);
      items.forEach((q, idx) => {
        insert.run(
          q.id || uuid(),
          req.params.id,
          q.label || 'Untitled',
          q.fieldType || 'text',
          q.required ? 1 : 0,
          q.options ? JSON.stringify(q.options) : null,
          q.sortOrder ?? idx,
        );
      });
    });
    tx(list);

    const rows = db.prepare('SELECT * FROM custom_questions WHERE page_id = ? AND type_id IS NULL ORDER BY sort_order').all(req.params.id);
    res.json({ ok: true, questions: rows.map(rowToQuestion) });
  } catch (err) {
    console.error('PUT /api/booking-pages/:id/questions:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// WORKFLOWS — sub-resource of a page
// ---------------------------------------------------------------------------

router.put('/api/booking-pages/:id/workflows', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Page not found' });
    }
    const list = Array.isArray(req.body?.workflows) ? req.body.workflows : [];
    // Reject any workflow with an unsafe URL up-front so we never persist one.
    for (const w of list) {
      if (w.webhookUrl && !isSafeWebhookUrl(w.webhookUrl)) {
        return res.status(400).json({
          ok: false,
          error: `Webhook URL is not allowed: ${w.webhookUrl}. Must be HTTPS to a public hostname.`,
        });
      }
    }
    const tx = db.transaction((items) => {
      db.prepare('DELETE FROM booking_workflows WHERE page_id = ?').run(req.params.id);
      const insert = db.prepare(`
        INSERT INTO booking_workflows (id, page_id, trigger, webhook_url, body_template, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const w of items) {
        insert.run(
          w.id || uuid(),
          req.params.id,
          w.trigger || 'on_booked',
          w.webhookUrl || null,
          w.bodyTemplate || null,
          w.isActive === false ? 0 : 1,
        );
      }
    });
    tx(list);
    const rows = db.prepare('SELECT * FROM booking_workflows WHERE page_id = ?').all(req.params.id);
    res.json({ ok: true, workflows: rows.map(rowToWorkflow) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SINGLE-USE INVITES
// ---------------------------------------------------------------------------

router.post('/api/booking-pages/:id/invites', (req, res) => {
  try {
    const db = getDb();
    const page = getOwnedPage(db, req.params.id, req.user.id);
    if (!page) return res.status(404).json({ ok: false, error: 'Page not found' });
    const token = randomToken();
    const expiresAt = req.body?.expiresAt || null;
    const typeId = req.body?.typeId || null;
    db.prepare('INSERT INTO booking_invites (token, page_id, type_id, expires_at) VALUES (?, ?, ?, ?)').run(token, req.params.id, typeId, expiresAt);
    res.json({ ok: true, token, url: `/book/i/${token}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/booking-pages/:id/invites', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Page not found' });
    }
    const rows = db.prepare(`
      SELECT bi.*, b.invitee_email, b.start_iso
      FROM booking_invites bi
      LEFT JOIN bookings b ON b.id = bi.used_by_booking_id
      WHERE bi.page_id = ?
      ORDER BY bi.created_at DESC
      LIMIT 100
    `).all(req.params.id);
    res.json({ ok: true, invites: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/booking-pages/:id/invites/:token', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Page not found' });
    }
    db.prepare('DELETE FROM booking_invites WHERE token = ? AND page_id = ?').run(req.params.token, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// TIME POLLS — list / confirm / decline pending polls for a page
// ---------------------------------------------------------------------------

router.get('/api/booking-pages/:id/polls', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Page not found' });
    }
    const rows = db.prepare(`
      SELECT * FROM time_polls
      WHERE page_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(req.params.id);
    const polls = rows.map((r) => {
      let proposed = [];
      try { proposed = JSON.parse(r.proposed_iso_json || '[]'); } catch {}
      return {
        id: r.id,
        pageId: r.page_id,
        inviteeEmail: r.invitee_email,
        proposedIso: proposed,
        selectedIso: r.selected_iso,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
    res.json({ ok: true, polls });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/api/booking-pages/:id/polls/:pollId', async (req, res) => {
  try {
    const db = getDb();
    const page = getOwnedPage(db, req.params.id, req.user.id);
    if (!page) return res.status(404).json({ ok: false, error: 'Not found' });
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM time_polls WHERE id = ? AND page_id = ?').get(req.params.pollId, req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    const newStatus = b.status ?? existing.status;
    const newSelected = b.selectedIso ?? existing.selected_iso;

    db.prepare(`
      UPDATE time_polls SET
        selected_iso = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newSelected, newStatus, req.params.pollId);

    // If the host just confirmed a poll with a selected slot, create a real
    // booking so the rest of the system (calendar event, emails, webhooks)
    // treats it like any other booking.
    let createdBooking = null;
    const wasConfirmed = newStatus === 'confirmed' && existing.status !== 'confirmed';
    if (wasConfirmed && newSelected) {
      const startMs = Date.parse(newSelected);
      const endMs = startMs + (page.duration_min || 30) * 60000;

      const bookingId = randomUUID();
      const cancelToken = randomToken();
      const rescheduleToken = randomToken();

      try {
        db.prepare(`
          INSERT INTO bookings (
            id, page_id, invitee_name, invitee_email,
            start_iso, end_iso, timezone,
            status, cancel_token, reschedule_token, payment_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'none')
        `).run(
          bookingId, page.id,
          existing.invitee_email, existing.invitee_email,
          new Date(startMs).toISOString(), new Date(endMs).toISOString(),
          page.timezone,
          cancelToken, rescheduleToken,
        );
        createdBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      } catch (err) {
        console.warn('poll → booking insert failed:', err.message);
      }

      // Best-effort: create the Google Calendar event.
      if (createdBooking && page.calendar_id && google.isConnected(page.user_id)) {
        try {
          const ev = await google.createEvent(page.user_id, page.calendar_id, {
            summary: `${page.title} — ${existing.invitee_email}`,
            description: `Confirmed from a time poll.\n\nProposed times: ${(JSON.parse(existing.proposed_iso_json || '[]')).join(', ')}\nChosen: ${newSelected}`,
            start: { dateTime: new Date(startMs).toISOString(), timeZone: page.timezone || 'UTC' },
            end:   { dateTime: new Date(endMs).toISOString(),   timeZone: page.timezone || 'UTC' },
            attendees: [{ email: existing.invitee_email }],
          });
          db.prepare('UPDATE bookings SET google_event_id = ?, google_calendar_id = ? WHERE id = ?')
            .run(ev.id, page.calendar_id, bookingId);
        } catch (err) {
          console.warn('poll → google event failed:', err.message);
        }
      }

      // Best-effort: send confirmation email + emit webhook event.
      if (createdBooking) {
        sendBookingConfirmation({
          page,
          booking: createdBooking,
          eventType: null,
          hostName: page.host_name,
          hostEmail: page.host_email,
        }).catch(() => {});

        emitEvent('booking.created', {
          source: 'time_poll',
          page: { slug: page.slug, title: page.title },
          booking: {
            id: createdBooking.id,
            email: createdBooking.invitee_email,
            startIso: createdBooking.start_iso,
            endIso: createdBooking.end_iso,
          },
        }, page.user_id).catch(() => {});
      }
    }

    const row = db.prepare('SELECT * FROM time_polls WHERE id = ?').get(req.params.pollId);
    let proposed = [];
    try { proposed = JSON.parse(row.proposed_iso_json || '[]'); } catch {}
    res.json({
      ok: true,
      poll: {
        id: row.id, pageId: row.page_id, inviteeEmail: row.invitee_email,
        proposedIso: proposed, selectedIso: row.selected_iso,
        status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      },
      bookingId: createdBooking?.id || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/booking-pages/:id/polls/:pollId', (req, res) => {
  try {
    const db = getDb();
    if (!getOwnedPage(db, req.params.id, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    db.prepare('DELETE FROM time_polls WHERE id = ? AND page_id = ?').run(req.params.pollId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ROUTING FORMS — top-level (not nested under a page)
// ---------------------------------------------------------------------------

router.get('/api/routing-forms', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM routing_forms WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ ok: true, forms: rows.map(mapForm) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/routing-forms', (req, res) => {
  try {
    const db = getDb();
    const id = uuid();
    const b = req.body || {};
    const baseSlug = slugify(b.slug || b.title || 'route');
    let slug = baseSlug;
    let i = 0;
    while (db.prepare('SELECT id FROM routing_forms WHERE slug = ?').get(slug)) {
      i += 1;
      slug = `${baseSlug}-${randomSlugFragment()}`;
      if (i > 5) { slug = `${baseSlug}-${Date.now().toString(36)}`; break; }
    }
    db.prepare(`
      INSERT INTO routing_forms (id, slug, title, description, questions_json, rules_json, is_active, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, slug, b.title || 'New form', b.description || null,
      JSON.stringify(b.questions || []),
      JSON.stringify(b.rules || []),
      b.isActive === false ? 0 : 1,
      req.user.id
    );
    const row = db.prepare('SELECT * FROM routing_forms WHERE id = ?').get(id);
    res.json({ ok: true, form: mapForm(row) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/api/routing-forms/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM routing_forms WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE routing_forms SET
        title = ?, description = ?,
        questions_json = ?, rules_json = ?, is_active = ?,
        updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      b.title ?? existing.title,
      b.description ?? existing.description,
      JSON.stringify(b.questions ?? JSON.parse(existing.questions_json)),
      JSON.stringify(b.rules ?? JSON.parse(existing.rules_json)),
      b.isActive === undefined ? existing.is_active : (b.isActive ? 1 : 0),
      req.params.id,
      req.user.id
    );
    const row = db.prepare('SELECT * FROM routing_forms WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json({ ok: true, form: mapForm(row) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/routing-forms/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM routing_forms WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function mapForm(row) {
  if (!row) return null;
  let questions = [];
  let rules = [];
  try { questions = JSON.parse(row.questions_json || '[]'); } catch {}
  try { rules = JSON.parse(row.rules_json || '[]'); } catch {}
  return {
    id: row.id, slug: row.slug, title: row.title, description: row.description,
    questions, rules, isActive: !!row.is_active,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export default router;
