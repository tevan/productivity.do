#!/bin/bash
# launch-go-live.sh — flip productivity.do from IP-allowlisted dev to public.
#
# What this does:
#   1. Backs up the current nginx config
#   2. Comments out the `allow 69.131.127.243; deny all;` lines
#   3. Tests the new config
#   4. Reloads nginx (only if the test passes)
#
# What this does NOT do:
#   - Set Stripe Price IDs (you must do that in the dashboard + .env)
#   - Verify Google OAuth (account-side approval process)
#   - Verify Resend domain
#   - Anything destructive without --confirm
#
# Usage:
#   ./scripts/launch-go-live.sh           # dry run (shows what would happen)
#   ./scripts/launch-go-live.sh --confirm # actually flip the switch
#   ./scripts/launch-go-live.sh --restore # revert from the backup file
#
# Read docs/LAUNCH-CHECKLIST.md before running.

set -euo pipefail

CONFIG=/etc/nginx/sites-available/productivity.do.conf
BACKUP="${CONFIG}.preLaunch"

log() { echo "[launch] $*"; }
err() { echo "[launch] ERROR: $*" >&2; exit 1; }

if [[ "${1:-}" == "--restore" ]]; then
  [[ -f "$BACKUP" ]] || err "no backup found at $BACKUP"
  log "restoring nginx config from backup"
  sudo cp "$BACKUP" "$CONFIG"
  sudo nginx -t && sudo systemctl reload nginx
  log "restored. site is back to IP-allowlisted."
  exit 0
fi

# Sanity: make sure the marker lines exist before we touch the file.
grep -q "^    allow 69.131.127.243;" "$CONFIG" || err "expected allowlist marker not found in $CONFIG; aborting"
grep -q "^    deny all;" "$CONFIG" || err "expected 'deny all' marker not found in $CONFIG; aborting"

if [[ "${1:-}" != "--confirm" ]]; then
  log "DRY RUN — pass --confirm to actually flip the switch."
  log ""
  log "Would back up:  $CONFIG  →  $BACKUP"
  log "Would comment out the allow/deny lines:"
  grep -n "^    allow 69.131.127.243;\|^    deny all;" "$CONFIG"
  log ""
  log "Reminders:"
  log "  - Confirm Stripe Price IDs are in .env (see docs/LAUNCH-CHECKLIST.md)"
  log "  - Confirm Resend domain is verified"
  log "  - Confirm you've tested signup + checkout end-to-end"
  log "  - You can revert with:  $0 --restore"
  exit 0
fi

log "backing up $CONFIG → $BACKUP"
sudo cp "$CONFIG" "$BACKUP"

log "commenting out the allowlist lines"
# Use # at column 0 so the file still reads cleanly. Don't sed-in-place
# without a backup; we already backed up above.
sudo sed -i \
  -e 's|^    allow 69.131.127.243;|    # allow 69.131.127.243;  # disabled by launch-go-live.sh|' \
  -e 's|^    deny all;|    # deny all;            # disabled by launch-go-live.sh|' \
  "$CONFIG"

log "testing nginx config"
if ! sudo nginx -t; then
  log "nginx config test FAILED — restoring from backup"
  sudo cp "$BACKUP" "$CONFIG"
  err "nginx -t failed; reverted. Investigate before retrying."
fi

log "reloading nginx"
sudo systemctl reload nginx

log "DONE — site is now public. Verify from an outside network."
log "If anything looks wrong, run: $0 --restore"
