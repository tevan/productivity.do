/**
 * Observations registry.
 *
 * Adding a new observation = drop a file in this directory and add it here.
 * The framework handles ranking, suppression, and serialization.
 *
 * Suggested cadence: ship one new observation every 2 weeks. The collection
 * is the moat; each individual observation is small.
 */
import pushedTasks from './pushed-tasks.js';
import meetingDensity from './meeting-density.js';
import completionTimePattern from './completion-time-pattern.js';

export const OBSERVERS = [
  pushedTasks,
  meetingDensity,
  completionTimePattern,
];
