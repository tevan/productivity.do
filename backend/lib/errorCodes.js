// Centralized API error codes.
//
// Every error response on the public /api/v1 surface should have:
//   { ok: false, code: <ERROR_CODE>, message: <human-readable>, [field]: <optional> }
//
// Codes are stable contracts — clients pattern-match on them, so renames
// are breaking. Add new codes; don't repurpose old ones. The category is
// the prefix before the underscore (auth_, plan_, validation_, ...).
//
// Stripe-style approach (Designing Web APIs Ch 7 / Geewax Ch 4): one
// readable string code per kind, plus the machine-friendly category, plus
// a human message. HTTP status carries the broad shape (4xx vs 5xx) and
// the code carries the precise reason.

export const ERROR_CODES = {
  // ---- auth_* — 401 ----
  auth_required: { http: 401, message: 'Authentication required' },
  auth_invalid: { http: 401, message: 'Invalid credentials' },
  auth_session_expired: { http: 401, message: 'Session expired — sign in again' },
  auth_key_invalid: { http: 401, message: 'API key is invalid or revoked' },
  auth_key_scope_missing: { http: 403, message: 'API key is missing the required scope' },

  // ---- plan_* — 402/403 ----
  // Frontend api() wrapper auto-triggers the upgrade modal on this code,
  // so the response also includes { requiredPlan, feature, detail? }.
  plan_required: { http: 402, message: 'This feature requires a higher plan' },
  plan_limit_reached: { http: 402, message: 'You have hit a plan limit — upgrade to continue' },

  // ---- validation_* — 400 ----
  validation_missing_field: { http: 400, message: 'Required field is missing' },
  validation_invalid_value: { http: 400, message: 'Field value is invalid' },
  validation_invalid_format: { http: 400, message: 'Value does not match the expected format' },
  validation_too_long: { http: 400, message: 'Value exceeds maximum length' },
  validation_invalid_status: { http: 400, message: 'Invalid status — pick from the allowed list' },

  // ---- not_found_* — 404 ----
  not_found: { http: 404, message: 'Resource not found' },
  not_found_resource_type: { http: 404, message: 'Unknown resource type' },

  // ---- conflict_* — 409 ----
  conflict_already_exists: { http: 409, message: 'A resource with the same key already exists' },
  conflict_state_invalid: { http: 409, message: 'Resource is not in a state that allows this action' },
  conflict_idempotency_mismatch: { http: 409, message: 'Idempotency-Key was reused with a different request body' },

  // ---- rate_* — 429 ----
  rate_limit_exceeded: { http: 429, message: 'Rate limit exceeded — slow down or wait for the reset window' },

  // ---- payload_* — 413/422 ----
  payload_too_large: { http: 413, message: 'Request body is too large' },
  bulk_too_many_items: { http: 422, message: 'Bulk requests are limited to 100 items' },

  // ---- upstream_* — 502/503 ----
  upstream_provider_error: { http: 502, message: 'A third-party provider returned an error' },
  upstream_unavailable: { http: 503, message: 'A required upstream is temporarily unavailable' },

  // ---- server_* — 500 ----
  server_error: { http: 500, message: 'Something went wrong on our side' },
  server_misconfigured: { http: 503, message: 'Server is missing required configuration for this feature' },
};

export function categoryOf(code) {
  return String(code || '').split('_', 1)[0] || 'unknown';
}

// Send a standardized error. Optional `extras` lets callers attach
// fields like `field`, `requiredPlan`, `feature`, `detail`. If a known
// code is passed but the caller wants to override the message (e.g.
// echo the actual missing field name), pass `{ message: '...' }` in
// `extras`.
export function sendError(res, code, extras = {}) {
  const def = ERROR_CODES[code];
  if (!def) {
    // Unknown code → coerce to server_error so we don't ship 200/OK
    // with a bogus shape; log so it's noticed in dev.
    console.warn(`[errorCodes] unknown code passed to sendError: ${code}`);
    return res.status(500).json({ ok: false, code: 'server_error', message: 'Internal error' });
  }
  const body = {
    ok: false,
    code,
    message: extras.message || def.message,
    ...extras,
  };
  // Don't leak internal `message` overrides as duplicates.
  delete body.message_override;
  return res.status(extras.http || def.http).json(body);
}

// Convenience for translating a thrown error from an upstream wrapper
// (Todoist, Google) into a 502 with the message preserved.
export function sendUpstreamError(res, err, opts = {}) {
  return sendError(res, 'upstream_provider_error', {
    message: err?.message || 'Upstream call failed',
    ...opts,
  });
}
