# Pipedream components

Pipedream components are open-source TypeScript modules. We submit a PR
to `PipedreamHQ/pipedream` adding `components/productivity_do/`.

## Layout

```
components/productivity_do/
  package.json
  productivity_do.app.mjs      # auth + http helpers
  actions/
    create-task/create-task.mjs
    create-event/create-event.mjs
    complete-task/complete-task.mjs
  sources/
    new-task/new-task.mjs        # polling source
    new-event/new-event.mjs
    new-booking/new-booking.mjs
```

## App definition

```js
// productivity_do.app.mjs
import { axios } from "@pipedream/platform";
export default {
  type: "app",
  app: "productivity_do",
  propDefinitions: { /* … */ },
  methods: {
    _baseUrl() { return "https://productivity.do/api/v1"; },
    _headers() { return { Authorization: `Bearer ${this.$auth.api_key}` }; },
    async listTasks(opts = {}) {
      return axios(this, { url: `${this._baseUrl()}/tasks`, headers: this._headers(), ...opts });
    },
    async createTask(data) {
      return axios(this, {
        method: "POST", url: `${this._baseUrl()}/tasks`,
        headers: { ...this._headers(), "Content-Type": "application/json" },
        data,
      });
    },
  },
};
```

## Auth registration

We register `productivity_do` as a custom OAuth/API-key app on Pipedream's
side. They support API key apps with one prompt — easier than IFTTT.

## Submission

Pipedream requires a working PR with at least one source + one action and
no failing tests. They merge fast (days, not weeks).
