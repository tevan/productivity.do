// Sentry wiring. The `init()` call is no-op if SENTRY_DSN is unset, so dev
// works without the env var. Production puts the DSN in `.env`.
//
// We use Sentry's structured imports rather than the meta-package so we
// don't pull in Sentry's optional integrations (replay, browser tracing,
// profiling) we don't need on the server.

import * as Sentry from '@sentry/node';

let enabled = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    // 0.1 = sample 10% of transactions for performance monitoring. Free
    // tier gives us 100k events/mo so this stays under quota at our scale.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    // Capture unhandled rejections — Node otherwise exits on them silently.
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    beforeSend(event, hint) {
      // Strip request bodies — they may contain Todoist tokens, passwords,
      // or other PII. Headers are scrubbed by Sentry's default PII rules
      // since we don't pass `sendDefaultPii: true`.
      if (event.request?.data) event.request.data = '[REDACTED]';
      return event;
    },
  });
  enabled = true;
  console.log('[sentry] error tracking enabled');
}

// Capture an arbitrary error from anywhere in the codebase. No-op if
// Sentry isn't initialized — keeps callers branchless.
export function captureError(err, context = {}) {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureException(err);
    });
  } catch (e) {
    console.error('[sentry] capture failed:', e?.message);
  }
}

// Express error-handler middleware. Mount AFTER all routes; before any
// final response handler. Forwards errors to Sentry then re-throws so
// Express's default error response still runs.
export function sentryErrorHandler(err, req, res, next) {
  if (enabled) {
    try {
      Sentry.withScope((scope) => {
        if (req.user?.id) scope.setUser({ id: String(req.user.id) });
        scope.setExtra('url', req.originalUrl);
        scope.setExtra('method', req.method);
        Sentry.captureException(err);
      });
    } catch {}
  }
  next(err);
}
