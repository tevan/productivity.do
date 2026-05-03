<script>
  /*
   * VoiceCapture — a small, self-contained mic button that records audio,
   * transcribes via /api/voice/transcribe, classifies via /api/voice/route,
   * and dispatches the result.
   *
   * Two modes:
   *   - 'capture' (default): mic icon → record → preview → confirm-routes
   *     to the right pillar (task/event/note/comment).
   *   - 'decision': mic icon → record → re-rank Today panel (the surface
   *     responds to spoken intent like "skip the meetings" or "show me
   *     pinned only"). v1: just transcribes; future: send transcript to
   *     /api/voice/route for action.
   *
   * Hides itself if the server returns 503 from transcribe (no API key).
   */
  import { getContext, onMount, onDestroy } from 'svelte';
  import { showToast } from '../utils/toast.svelte.js';
  import { tooltip } from '../actions/tooltip.js';
  import { api } from '../api.js';

  let { mode = 'capture', onresult = () => {}, label = '' } = $props();

  const appCtx = getContext('app');

  let recording = $state(false);
  let processing = $state(false);
  let preview = $state(null); // { kind, confidence, fields, summary, transcript }
  let unsupported = $state(false);
  let mediaRecorder = null;
  let chunks = [];
  let mediaStream = null;

  // Probe support once. Most modern browsers support MediaRecorder; older
  // Safari might not. We bail gracefully.
  onMount(() => {
    if (typeof window === 'undefined') return;
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      unsupported = true;
    }
  });
  onDestroy(() => {
    stopStream();
  });

  function stopStream() {
    if (mediaStream) {
      for (const t of mediaStream.getTracks()) t.stop();
      mediaStream = null;
    }
  }

  async function startRecording() {
    if (recording || processing) return;
    chunks = [];
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showToast({ message: 'Microphone access denied', kind: 'error' });
      return;
    }
    const mime = pickMimeType();
    try {
      mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      showToast({ message: 'Recording not supported in this browser', kind: 'error' });
      stopStream();
      return;
    }
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();
    recording = true;
  }

  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const c of candidates) {
      if (window.MediaRecorder?.isTypeSupported?.(c)) return c;
    }
    return null;
  }

  async function stopRecording() {
    if (!mediaRecorder || !recording) return;
    recording = false;
    try { mediaRecorder.stop(); } catch {}
  }

  async function handleStop() {
    stopStream();
    if (chunks.length === 0) {
      processing = false;
      return;
    }
    const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    chunks = [];
    if (blob.size < 200) {
      // Way too short — under ~0.5s of audio; suppress the call.
      return;
    }

    processing = true;
    try {
      const fd = new FormData();
      const ext = mediaRecorder?.mimeType?.includes('mp4') ? 'mp4'
                : mediaRecorder?.mimeType?.includes('ogg') ? 'ogg'
                : 'webm';
      fd.append('audio', blob, `audio.${ext}`);
      const transcribeRes = await fetch('/api/voice/transcribe', {
        method: 'POST', body: fd, credentials: 'same-origin',
      });
      if (transcribeRes.status === 503) {
        showToast({ message: 'Voice transcription not configured.', kind: 'error' });
        unsupported = true;
        processing = false;
        return;
      }
      const transcribed = await transcribeRes.json();
      if (!transcribed?.ok || !transcribed.transcript) {
        showToast({ message: transcribed?.error || 'Could not understand audio.', kind: 'error' });
        processing = false;
        return;
      }

      if (mode === 'decision') {
        // Decision mode v1: just hand the transcript back to the parent.
        // Future: pipe through /api/voice/route + act on classification.
        onresult({ transcript: transcribed.transcript });
        processing = false;
        return;
      }

      // Capture mode: classify.
      const routed = await api('/api/voice/route', {
        method: 'POST',
        body: JSON.stringify({ transcript: transcribed.transcript, context: 'capture' }),
      });
      if (!routed?.ok) {
        showToast({ message: routed?.error || 'Could not classify.', kind: 'error' });
        processing = false;
        return;
      }
      preview = {
        kind: routed.kind,
        confidence: routed.confidence,
        fields: routed.fields || {},
        summary: routed.summary,
        transcript: transcribed.transcript,
      };
    } catch (err) {
      showToast({ message: String(err?.message || err), kind: 'error' });
    } finally {
      processing = false;
    }
  }

  async function confirmCreate() {
    if (!preview) return;
    const { kind, fields } = preview;
    try {
      if (kind === 'task') {
        const res = await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            content: fields.content || preview.transcript,
            dueDate: fields.dueDate || null,
            priority: fields.priority || 1,
            estimatedMinutes: fields.estimatedMinutes || null,
          }),
        });
        if (res?.ok) showToast({ message: 'Task captured', kind: 'success' });
        else showToast({ message: res?.error || 'Could not create task', kind: 'error' });
      } else if (kind === 'event') {
        if (appCtx?.editEvent) {
          appCtx.editEvent({
            summary: fields.summary || preview.transcript,
            start: fields.start, end: fields.end,
            location: fields.location || null,
          });
          showToast({ message: 'Review and save the event', kind: 'info' });
        }
      } else if (kind === 'note') {
        const res = await api('/api/notes', {
          method: 'POST',
          body: JSON.stringify({
            title: fields.title || '',
            body: fields.body || preview.transcript,
          }),
        });
        if (res?.ok) showToast({ message: 'Note captured', kind: 'success' });
        else showToast({ message: res?.error || 'Could not create note', kind: 'error' });
      } else {
        // comment / unsure — fall back to creating a note
        const res = await api('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ title: '', body: preview.transcript }),
        });
        if (res?.ok) showToast({ message: 'Saved as a note', kind: 'success' });
      }
    } finally {
      preview = null;
      onresult({ created: true, kind });
    }
  }

  function dismissPreview() {
    preview = null;
  }

  function onClick() {
    if (recording) stopRecording();
    else startRecording();
  }
</script>

{#if !unsupported}
  <button
    class="mic-btn"
    class:recording
    class:processing
    onclick={onClick}
    disabled={processing}
    use:tooltip={recording ? 'Stop recording' : (label || 'Voice capture')}
    aria-label={recording ? 'Stop recording' : 'Start voice capture'}
  >
    {#if processing}
      <svg width="16" height="16" viewBox="0 0 16 16" class="spinner" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-dasharray="20 20"/>
      </svg>
    {:else}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="2" width="4" height="7" rx="2"/>
        <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0"/>
        <path d="M8 12v2"/>
        <path d="M5.5 14h5"/>
      </svg>
    {/if}
  </button>
{/if}

{#if preview}
  <div class="preview-backdrop" onclick={dismissPreview} role="presentation">
    <div class="preview" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <header class="preview-head">
        <span class="kind kind-{preview.kind}">{preview.kind}</span>
        <span class="confidence">{preview.confidence} confidence</span>
        <button class="close" onclick={dismissPreview} aria-label="Close">×</button>
      </header>
      <p class="summary">{preview.summary}</p>
      {#if preview.kind === 'task' && preview.fields}
        <dl class="fields">
          {#if preview.fields.content}<dt>Task</dt><dd>{preview.fields.content}</dd>{/if}
          {#if preview.fields.dueDate}<dt>Due</dt><dd>{preview.fields.dueDate}</dd>{/if}
          {#if preview.fields.priority}<dt>Priority</dt><dd>P{5 - preview.fields.priority}</dd>{/if}
          {#if preview.fields.estimatedMinutes}<dt>Est.</dt><dd>{preview.fields.estimatedMinutes}m</dd>{/if}
        </dl>
      {:else if preview.kind === 'event' && preview.fields}
        <dl class="fields">
          {#if preview.fields.summary}<dt>Event</dt><dd>{preview.fields.summary}</dd>{/if}
          {#if preview.fields.start}<dt>Start</dt><dd>{preview.fields.start}</dd>{/if}
          {#if preview.fields.end}<dt>End</dt><dd>{preview.fields.end}</dd>{/if}
          {#if preview.fields.location}<dt>Location</dt><dd>{preview.fields.location}</dd>{/if}
        </dl>
      {:else if preview.kind === 'note' && preview.fields}
        <dl class="fields">
          {#if preview.fields.title}<dt>Title</dt><dd>{preview.fields.title}</dd>{/if}
          {#if preview.fields.body}<dt>Body</dt><dd>{preview.fields.body}</dd>{/if}
        </dl>
      {/if}
      <p class="transcript"><em>"{preview.transcript}"</em></p>
      <footer class="preview-foot">
        <button class="btn-secondary" onclick={dismissPreview}>Cancel</button>
        <button class="btn-primary" onclick={confirmCreate}>
          {preview.kind === 'event' ? 'Open editor' : 'Create'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .mic-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    cursor: pointer;
    position: relative;
  }
  .mic-btn:hover { background: var(--hover); color: var(--text-primary); }
  .mic-btn.recording {
    color: var(--error, #c25e4d);
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
  }
  .mic-btn.recording::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    box-shadow: 0 0 0 0 currentColor;
    animation: pulseRing 1.4s ease-out infinite;
  }
  @keyframes pulseRing {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--error, #c25e4d) 50%, transparent); }
    100% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--error, #c25e4d) 0%, transparent); }
  }
  .mic-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .spinner { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim, rgba(0,0,0,0.22));
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 16px;
    animation: fade 220ms ease both;
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .preview {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-lg);
    width: 460px;
    max-width: 100%;
    padding: 16px;
    animation: bloom 220ms cubic-bezier(.2,.7,.2,1) both;
  }
  @keyframes bloom {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .preview-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
  .kind {
    text-transform: uppercase;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--hover);
    color: var(--text-secondary);
  }
  .kind-task { background: color-mix(in srgb, var(--accent, #3b82f6) 14%, transparent); color: var(--accent, #3b82f6); }
  .kind-event { background: color-mix(in srgb, #15803d 14%, transparent); color: #15803d; }
  .kind-note { background: color-mix(in srgb, #b45309 14%, transparent); color: #b45309; }
  .confidence { font-size: 11px; color: var(--text-tertiary); text-transform: lowercase; flex: 1; }
  .close { background: none; border: none; cursor: pointer; color: var(--text-tertiary); width: 24px; height: 24px; font-size: 16px; }
  .summary { margin: 8px 0 12px; font-size: 14px; color: var(--text-primary); line-height: 1.4; }
  .fields { margin: 8px 0 12px; display: grid; grid-template-columns: 80px 1fr; gap: 6px 12px; font-size: 13px; }
  .fields dt { color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 2px; }
  .fields dd { margin: 0; color: var(--text-primary); }
  .transcript { margin: 8px 0; font-size: 12px; color: var(--text-tertiary); line-height: 1.4; }
  .preview-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .btn-primary, .btn-secondary {
    padding: 6px 14px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
  }
  .btn-primary {
    background: var(--accent, #3b82f6);
    border-color: var(--accent, #3b82f6);
    color: white;
  }
  .btn-primary:hover { background: color-mix(in srgb, var(--accent, #3b82f6) 88%, black); }
  .btn-secondary:hover { background: var(--hover); }
</style>
