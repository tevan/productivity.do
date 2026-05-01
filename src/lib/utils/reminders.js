let timers = [];
let audioCtx = null;

// Call this from a user gesture (e.g. enabling notifications) to unlock audio
export function initAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playChime() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.frequency.value = 1100;
      gain2.gain.value = 0.1;
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.15);
    }, 200);
  } catch {}
}

export function scheduleReminders(events, reminderMinutes, soundEnabled) {
  clearReminders();

  if (!reminderMinutes || !('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const leadMs = reminderMinutes * 60000;

  for (const event of events) {
    if (event.allDay) continue;
    const start = new Date(event.start).getTime();
    const fireAt = start - leadMs;
    const delay = fireAt - now;

    if (delay > 0 && delay < 86400000) {
      const timer = setTimeout(() => {
        const title = event.summary || '(No title)';
        const body = reminderMinutes >= 60
          ? `Starting in ${reminderMinutes / 60} hour${reminderMinutes > 60 ? 's' : ''}`
          : `Starting in ${reminderMinutes} minutes`;
        const n = new Notification(title, {
          body,
          icon: '/favicon.svg',
          tag: `event-${event.id}`,
        });
        setTimeout(() => n.close(), 30000);

        if (soundEnabled) {
          playChime();
        }
      }, delay);
      timers.push(timer);
    }
  }
}

export function clearReminders() {
  timers.forEach(t => clearTimeout(t));
  timers = [];
}
