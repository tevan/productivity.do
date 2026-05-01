// LRO polling + wait endpoints.
//
// Geewax Ch 10. Operations are scoped per user; one user cannot see
// another's operations. The router is mounted under requireAuth so all
// reads carry an authenticated session.
//
// Two read variants:
//   GET /api/operations/:id          — cheap; returns current state
//   GET /api/operations/:id:wait     — blocks up to 30s for completion
//
// The `:wait` colon-syntax is Geewax Ch 9 §custom methods. We use it on
// new endpoints; legacy endpoints keep `/verb` form.

import { Router } from 'express';
import { getOperation, waitForOperation } from '../lib/operations.js';

const router = Router();

router.get('/api/operations/:id', (req, res) => {
  const op = getOperation(req.params.id, req.user.id);
  if (!op) return res.status(404).json({ ok: false, error: 'Operation not found' });
  res.json({ ok: true, operation: op });
});

router.get('/api/operations/:id\\:wait', async (req, res) => {
  const op = await waitForOperation(req.params.id, req.user.id, { timeoutMs: 30_000 });
  if (!op) return res.status(404).json({ ok: false, error: 'Operation not found' });
  res.json({ ok: true, operation: op });
});

export default router;
