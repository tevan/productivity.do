import * as chrono from 'chrono-node';

export function parseInput(text) {
  if (!text || !text.trim()) return null;

  const trimmed = text.trim();

  // Check for task prefix
  const taskPrefixes = /^(task|todo|remind|reminder)\s*:?\s*/i;
  const isTask = taskPrefixes.test(trimmed);
  const cleanText = trimmed.replace(taskPrefixes, '');

  const results = chrono.parse(cleanText, new Date(), { forwardDate: true });

  if (results.length === 0) {
    return { title: cleanText, start: null, end: null, isTask, isSearch: !isTask };
  }

  const result = results[0];
  const title = cleanText.slice(0, result.index).trim() ||
    cleanText.slice(result.index + result.text.length).trim() ||
    cleanText;

  const start = result.start ? result.start.date() : null;
  let end = result.end ? result.end.date() : null;

  // Default 30-minute duration if no end time
  if (start && !end && !isTask) {
    end = new Date(start.getTime() + 30 * 60 * 1000);
  }

  // Detect duration hints like "for 1h", "for 2 hours", "for 45min"
  const durationMatch = cleanText.match(/\bfor\s+(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
  if (durationMatch && start) {
    const amount = parseInt(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    const ms = unit.startsWith('h') ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    end = new Date(start.getTime() + ms);
  }

  return {
    title: title.replace(/\bfor\s+\d+\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i, '').trim() || title,
    start,
    end,
    isTask,
    isSearch: false,
  };
}
