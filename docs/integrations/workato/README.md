# Workato connector

Workato connectors are written in **Ruby** (their Connector SDK). They
target enterprise iPaaS users.

## Manifest sketch (Ruby DSL)

```ruby
{
  title: 'productivity.do',
  connection: {
    fields: [
      { name: 'api_key', label: 'API key', control_type: 'password',
        optional: false, hint: 'productivity.do → Settings → Developer' },
    ],
    authorization: {
      type: 'custom_auth',
      apply: lambda do |connection|
        headers('Authorization' => "Bearer #{connection['api_key']}")
      end,
    },
    base_uri: ->(_) { 'https://productivity.do/api/v1' },
  },
  test: ->(_) { get('/me') },

  actions: {
    create_task: {
      input_fields: -> { [
        { name: 'title', optional: false },
        { name: 'dueDate', type: :date_time },
        { name: 'priority', type: :integer },
      ]},
      execute: ->(_, input) { post('/tasks', input) },
      output_fields: -> { object_definitions['task'] },
    },
  },

  triggers: {
    new_task: {
      poll: ->(_, input, since) {
        result = get('/tasks').params(since: since)
        { events: result['tasks'], next_poll: now }
      },
    },
  },

  object_definitions: {
    task: { fields: -> { [
      { name: 'id' }, { name: 'title' }, { name: 'completed', type: :boolean },
      { name: 'dueDate', type: :date_time },
    ]}},
  },
}
```

## Submission

Workato has a "Custom connectors" tier — anyone with a Workato account
can add the manifest as a private custom connector. Public listing
requires Workato partnership (paid). Plan: ship private first, push for
public listing once we have customer demand.
