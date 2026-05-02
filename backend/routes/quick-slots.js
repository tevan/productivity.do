import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/init.js';

const adminRouter = Router();
const publicRouter = Router();

// Admin: create a one-off appointment-slot link.
// Body: { title, durationMin, slots: [iso...], timezone, expiresAt? }
adminRouter.post('/api/quick-slots', (req, res) => {
  const { title, durationMin, slots, timezone, expiresAt } = req.body || {};
  if (!Array.isArray(slots) || !slots.length) return res.status(400).json({ ok: false, error: 'slots required' });
  if (!timezone) return res.status(400).json({ ok: false, error: 'timezone required' });
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const exp = expiresAt || new Date(Date.now() + 14 * 86400000).toISOString();
  getDb().prepare(`
    INSERT INTO quick_slots (id, user_id, title, duration_min, slots_json, timezone, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, title || 'Meeting', Number(durationMin) || 30, JSON.stringify(slots), timezone, exp);
  res.json({ ok: true, id, url: `/q/${id}` });
});

adminRouter.get('/api/quick-slots', (req, res) => {
  const rows = getDb().prepare(
    'SELECT * FROM quick_slots WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user.id);
  res.json({ ok: true, slots: rows.map(r => ({
    id: r.id, title: r.title, durationMin: r.duration_min,
    slots: JSON.parse(r.slots_json), timezone: r.timezone,
    bookedByEmail: r.booked_by_email, bookedSlotIso: r.booked_slot_iso,
    expiresAt: r.expires_at, createdAt: r.created_at,
  })) });
});

adminRouter.delete('/api/quick-slots/:id', (req, res) => {
  getDb().prepare('DELETE FROM quick_slots WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Public: read available slots, book a slot.
publicRouter.get('/api/public/quick-slots/:id', (req, res) => {
  const r = getDb().prepare('SELECT * FROM quick_slots WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  if (new Date(r.expires_at) < new Date()) return res.status(410).json({ ok: false, error: 'Expired' });
  res.json({ ok: true, slot: {
    id: r.id, title: r.title, durationMin: r.duration_min,
    slots: JSON.parse(r.slots_json), timezone: r.timezone,
    booked: !!r.booked_at,
  } });
});

publicRouter.post('/api/public/quick-slots/:id/book', (req, res) => {
  const { slotIso, email, name } = req.body || {};
  if (!slotIso || !email) return res.status(400).json({ ok: false, error: 'slotIso+email required' });
  const db = getDb();
  const tx = db.transaction(() => {
    const r = db.prepare('SELECT * FROM quick_slots WHERE id = ?').get(req.params.id);
    if (!r) throw new Error('Not found');
    if (r.booked_at) throw new Error('Already booked');
    if (new Date(r.expires_at) < new Date()) throw new Error('Expired');
    const slots = JSON.parse(r.slots_json);
    if (!slots.includes(slotIso)) throw new Error('Slot not offered');
    db.prepare(`
      UPDATE quick_slots
      SET booked_by_email = ?, booked_at = datetime('now'), booked_slot_iso = ?
      WHERE id = ? AND booked_at IS NULL
    `).run(email, slotIso, req.params.id);
  });
  try {
    tx();
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

// Public widget — self-contained HTML page that calls the public API.
publicRouter.get('/q/:id', (req, res) => {
  const id = String(req.params.id).replace(/[^a-zA-Z0-9]/g, '');
  const idJson = JSON.stringify(id);
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light dark"/>
<title>Pick a time</title>
<style>
html, html body { background: #ffffff; }
@media (prefers-color-scheme: dark) { html, html body { background: #0f1115; color: #e8eaed; } }
body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 24px auto; padding: 24px; }
.card { border: 1px solid #e2e5e9; border-radius: 12px; padding: 24px; }
@media (prefers-color-scheme: dark) { .card { border-color: #2d3139; background: #1a1d23; } }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
.slot { display: block; width: 100%; text-align: left; padding: 10px 14px; margin: 6px 0; border-radius: 8px; border: 1px solid #e2e5e9; background: #fff; cursor: pointer; font-size: 14px; }
@media (prefers-color-scheme: dark) { .slot { background: #0f1115; border-color: #2d3139; color: #e8eaed; } }
.slot:hover { border-color: #3b82f6; }
input { width: 100%; padding: 10px 12px; border: 1px solid #e2e5e9; border-radius: 8px; margin: 6px 0; font-size: 14px; }
@media (prefers-color-scheme: dark) { input { background: #0f1115; color: #e8eaed; border-color: #2d3139; } }
button.primary { width: 100%; padding: 10px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
.ok { padding: 24px; text-align: center; }
.err { color: #dc2626; margin-top: 12px; }
.powered-by { display: block; text-align: center; margin-top: 16px; font-size: 12px; color: #6b7280; text-decoration: none; }
.powered-by:hover { color: #111827; }
.powered-by strong { color: #111827; font-weight: 600; }
@media (prefers-color-scheme: dark) { .powered-by { color: #9aa0a8; } .powered-by:hover, .powered-by strong { color: #e8eaed; } }
</style></head><body>
<div class="card" id="root"></div>
<a class="powered-by" href="https://productivity.do/signup" target="_blank" rel="noopener">Powered by <strong>productivity.do</strong> — make your own free</a>
<script>
const ID = ${idJson};
const root = document.getElementById('root');
let chosen = null;
function clearRoot() { while (root.firstChild) root.removeChild(root.firstChild); }
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) e.addEventListener(evt, fn);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
function setMessage(text) { clearRoot(); root.appendChild(el('p', {}, text)); }
async function load() {
  setMessage('Loading…');
  const r = await fetch('/api/public/quick-slots/' + ID).then(r => r.json()).catch(() => null);
  if (!r || !r.ok) return setMessage('Link not available.');
  if (r.slot.booked) {
    clearRoot();
    const ok = el('div', { class: 'ok' }, el('h1', {}, 'Already booked.'));
    return root.appendChild(ok);
  }
  renderSlots(r.slot);
}
function renderSlots(s) {
  clearRoot();
  root.appendChild(el('h1', {}, s.title));
  root.appendChild(el('div', { class: 'sub' }, s.durationMin + ' min · ' + s.timezone));
  const list = el('div');
  for (const iso of s.slots) {
    const label = new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    list.appendChild(el('button', {
      class: 'slot',
      on: { click: () => { chosen = iso; renderForm(s); } },
    }, label));
  }
  root.appendChild(list);
}
function renderForm(s) {
  clearRoot();
  root.appendChild(el('h1', {}, s.title));
  root.appendChild(el('div', { class: 'sub' }, new Date(chosen).toLocaleString()));
  const nameInput = el('input', { placeholder: 'Your name' });
  const emailInput = el('input', { type: 'email', placeholder: 'you@example.com' });
  const errSlot = el('div');
  const submit = el('button', {
    class: 'primary',
    on: { click: async () => {
      const email = emailInput.value.trim();
      const name = nameInput.value.trim();
      if (!email) return;
      const r = await fetch('/api/public/quick-slots/' + ID + '/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIso: chosen, email, name }),
      }).then(r => r.json());
      if (r.ok) {
        clearRoot();
        root.appendChild(el('div', { class: 'ok' },
          el('h1', {}, "You're booked."),
          el('p', {}, new Date(chosen).toLocaleString()),
        ));
      } else {
        clearRoot();
        renderForm(s);
        const err = el('div', { class: 'err' }, r.error || 'Failed');
        root.appendChild(err);
      }
    } },
  }, 'Confirm');
  root.appendChild(nameInput);
  root.appendChild(emailInput);
  root.appendChild(submit);
  root.appendChild(errSlot);
}
load();
</script></body></html>`);
});

export { adminRouter as quickSlotsAdmin, publicRouter as quickSlotsPublic };
