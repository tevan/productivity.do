/**
 * Row → API mapping helpers, shared between admin and public booking routes.
 */

export function rowToPage(row) {
  if (!row) return null;
  let availability = null;
  let checkIds = null;
  try { availability = JSON.parse(row.availability_json || '{}'); } catch {}
  try { checkIds = JSON.parse(row.check_calendar_ids || '[]'); } catch { checkIds = []; }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    durationMin: row.duration_min,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    locationType: row.location_type,
    locationValue: row.location_value,
    color: row.color,
    brandColor: row.brand_color,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    isActive: !!row.is_active,
    calendarId: row.calendar_id,
    checkCalendarIds: Array.isArray(checkIds) ? checkIds : [],
    minNoticeMin: row.min_notice_min,
    maxAdvanceDays: row.max_advance_days,
    dailyMax: row.daily_max,
    minGapMin: row.min_gap_min || 0,
    weeklyMax: row.weekly_max,
    slotStepMin: row.slot_step_min,
    availability,
    timezone: row.timezone,
    requirePhone: !!row.require_phone,
    customQuestion: row.custom_question,
    redirectUrl: row.redirect_url,
    hostName: row.host_name,
    hostEmail: row.host_email,
    hasEventTypes: !!row.has_event_types,
    enableIcs: row.enable_ics === undefined ? true : !!row.enable_ics,
    sendEmails: row.send_emails === undefined ? true : !!row.send_emails,
    reminder24h: row.reminder_24h === undefined ? true : !!row.reminder_24h,
    assignmentStrategy: row.assignment_strategy || 'single',
    hostUserIds: parseHostUserIds(row.host_user_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseHostUserIds(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.filter(x => Number.isFinite(Number(x))).map(Number) : [];
  } catch { return []; }
}

export function rowToEventType(row) {
  if (!row) return null;
  return {
    id: row.id,
    pageId: row.page_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    durationMin: row.duration_min,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    locationType: row.location_type,
    locationValue: row.location_value,
    color: row.color,
    capacity: row.capacity || 1,
    isActive: !!row.is_active,
    sortOrder: row.sort_order || 0,
    priceCents: row.price_cents,
    priceCurrency: row.price_currency,
  };
}

export function rowToQuestion(row) {
  if (!row) return null;
  let options = null;
  try { options = JSON.parse(row.options_json || 'null'); } catch {}
  return {
    id: row.id,
    pageId: row.page_id,
    typeId: row.type_id,
    label: row.label,
    fieldType: row.field_type,
    required: !!row.required,
    options,
    sortOrder: row.sort_order || 0,
  };
}

export function rowToWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    pageId: row.page_id,
    trigger: row.trigger,
    webhookUrl: row.webhook_url,
    bodyTemplate: row.body_template,
    isActive: !!row.is_active,
  };
}

/**
 * API-key-facing projection. Includes admin fields like id, availability,
 * calendar IDs — but never the host's email address. Use for `/api/v1/*`.
 */
export function apiPage(row) {
  if (!row) return null;
  const p = rowToPage(row);
  // hostEmail intentionally omitted; everything else passes through.
  // (rowToPage spreads from the row, so we explicitly drop the leaked field.)
  // eslint-disable-next-line no-unused-vars
  const { hostEmail, ...rest } = p;
  return rest;
}

/**
 * Public-facing projection (strip host_email, internal flags, etc).
 */
export function publicPage(row, eventTypes = [], questions = []) {
  if (!row) return null;
  const p = rowToPage(row);
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    durationMin: p.durationMin,
    locationType: p.locationType,
    locationValue: p.locationValue,
    color: p.color,
    brandColor: p.brandColor,
    logoUrl: p.logoUrl,
    coverImageUrl: p.coverImageUrl,
    timezone: p.timezone,
    requirePhone: p.requirePhone,
    hostName: p.hostName,
    minNoticeMin: p.minNoticeMin,
    maxAdvanceDays: p.maxAdvanceDays,
    isActive: p.isActive,
    hasEventTypes: p.hasEventTypes,
    eventTypes: eventTypes.map(rowToEventType).filter(t => t.isActive),
    questions: questions.map(rowToQuestion),
    availabilityWeekdays: weekdaysWithAvailability(p.availability),
  };
}

function weekdaysWithAvailability(av) {
  const open = [];
  for (const k of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
    const slots = av?.[k];
    if (Array.isArray(slots) && slots.length > 0) open.push(k);
  }
  return open;
}
