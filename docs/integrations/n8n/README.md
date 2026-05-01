# n8n community node

Published as `n8n-nodes-productivity-do` on npm. Users self-hosting n8n
install it via `npm install n8n-nodes-productivity-do` then restart their
instance.

Repo layout (when we scaffold):

```
n8n-nodes-productivity-do/
  package.json
  credentials/ProductivityDoApi.credentials.ts
  nodes/
    ProductivityDo.node.ts             # actions
    ProductivityDoTrigger.node.ts      # triggers (webhook-based)
  README.md
```

## Credentials

```ts
export class ProductivityDoApi implements ICredentialType {
  name = 'productivityDoApi';
  displayName = 'productivity.do API';
  documentationUrl = 'https://productivity.do/developers';
  properties: INodeProperties[] = [{
    displayName: 'API key', name: 'apiKey', type: 'string',
    typeOptions: { password: true }, default: '',
  }];
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
  };
  test: ICredentialTestRequest = {
    request: { baseURL: 'https://productivity.do', url: '/api/v1/me' },
  };
}
```

## Trigger node — webhook-based

n8n Trigger nodes can register a webhook URL with our backend on activation:

- onCreate(): `POST /api/v1/webhooks` with `{url, events:[…]}` →
  store `id` in static data
- onDelete(): `DELETE /api/v1/webhooks/:id` from static data
- webhook handler: `JSON.parse(body)` → emit

This means we get push events, no polling. n8n verified-partner status
requires this approach (polling is discouraged for community nodes).

## Submission

n8n takes community nodes that follow their guidelines (no native deps,
TypeScript, lint clean). Verified-partner is a separate process — apply
via n8n.io/partner once we have ≥50 active installs.
