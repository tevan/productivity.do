<script>
  import Dropdown from '../components/Dropdown.svelte';

  let { slug } = $props();

  let form = $state(null);
  let answers = $state({});
  let loading = $state(true);
  let submitting = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/public/forms/${slug}`).then(r => r.json());
      if (res.ok) form = res.form;
      else error = res.error || 'Form not found.';
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
  load();

  async function submit() {
    submitting = true;
    error = '';
    try {
      const res = await fetch(`/api/public/forms/${slug}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      }).then(r => r.json());
      if (!res.ok) {
        error = res.error || 'Could not route.';
        return;
      }
      if (res.target?.url) {
        window.location.href = res.target.url;
      } else {
        error = 'No matching booking page for those answers. Please try different selections.';
      }
    } catch (e) {
      error = e.message;
    } finally {
      submitting = false;
    }
  }
</script>

{#if loading}
  <div class="card"><p>Loading…</p></div>
{:else if !form}
  <div class="card error">{error || 'Form not found.'}</div>
{:else}
  <div class="card">
    <h1>{form.title}</h1>
    {#if form.description}<p class="desc">{form.description}</p>{/if}

    {#each form.questions || [] as q (q.id)}
      <div class="field">
        <label for={q.id}>{q.label}{q.required ? ' *' : ''}</label>
        {#if q.fieldType === 'select'}
          <Dropdown
            bind:value={answers[q.id]}
            ariaLabel={q.label}
            placeholder="— pick one —"
            options={(q.options || []).map(opt => ({ value: opt, label: opt }))}
          />
        {:else if q.fieldType === 'textarea'}
          <textarea id={q.id} bind:value={answers[q.id]} rows="3"></textarea>
        {:else if q.fieldType === 'checkbox'}
          <label class="check">
            <input type="checkbox" bind:checked={answers[q.id]} />
            <span>Yes</span>
          </label>
        {:else}
          <input id={q.id} type="text" bind:value={answers[q.id]} />
        {/if}
      </div>
    {/each}

    {#if error}<div class="err">{error}</div>{/if}

    <button class="submit" onclick={submit} disabled={submitting}>
      {submitting ? 'Routing…' : 'Continue'}
    </button>
  </div>
{/if}

<style>
  .card {
    background: white;
    border-radius: 16px;
    padding: 36px 32px;
    max-width: 520px;
    width: 100%;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .desc { color: #6b7280; margin: 0 0 24px; line-height: 1.5; }
  .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
  .field label { font-size: 13px; color: #4b5563; font-weight: 500; }
  .field input, .field select, .field textarea {
    padding: 10px 12px; border: 1px solid #e2e5e9; border-radius: 8px; font-family: inherit;
    font-size: 15px; outline: none;
  }
  .field input:focus, .field select:focus, .field textarea:focus { border-color: #6366f1; }
  .check { flex-direction: row; align-items: center; gap: 8px; }
  .err {
    background: rgba(239,68,68,0.1); color: #b91c1c; padding: 10px 14px;
    border-radius: 8px; font-size: 13px; margin-bottom: 14px;
  }
  .submit {
    width: 100%; padding: 12px; background: #6366f1; color: white; border: none;
    border-radius: 8px; font-size: 15px; font-weight: 500; cursor: pointer;
  }
  .submit:hover { background: #4f46e5; }
  .submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: #b91c1c; }
</style>
