# Activepieces piece

Activepieces "pieces" are TypeScript packages published to npm and
mirrored into their `pieces/` monorepo via PR.

## Layout

```
pieces/community/productivity-do/
  src/
    index.ts                          # piece definition
    lib/
      common.ts                       # shared client
      actions/create-task.ts
      actions/create-event.ts
      actions/complete-task.ts
      triggers/new-task.ts            # webhook trigger
      triggers/new-event.ts
      triggers/new-booking.ts
  package.json
  README.md
```

## Piece definition

```ts
import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { newTask } from './lib/triggers/new-task';
import { createTask } from './lib/actions/create-task';
// …

export const productivityDoAuth = PieceAuth.SecretText({
  displayName: 'API key',
  description: 'productivity.do → Settings → Developer',
  required: true,
  validate: async ({ auth }) => {
    const r = await fetch('https://productivity.do/api/v1/me', {
      headers: { Authorization: `Bearer ${auth}` },
    });
    return r.ok ? { valid: true } : { valid: false, error: 'Invalid API key' };
  },
});

export const productivityDo = createPiece({
  displayName: 'productivity.do',
  auth: productivityDoAuth,
  minimumSupportedRelease: '0.36.0',
  logoUrl: 'https://productivity.do/logo.png',
  authors: ['productivity-do'],
  actions: [createTask, createEvent, completeTask, /* … */],
  triggers: [newTask, newEvent, newBooking, /* … */],
});
```

## Triggers — webhook-style

Activepieces supports `WEBHOOK`-strategy triggers. On `onEnable` we
register with `POST /api/v1/webhooks`; on `onDisable` we remove.

## Submission

Activepieces accepts community pieces via PR to their open-source repo.
Approval is fast (days). MIT-licensed; no commercial constraints.
