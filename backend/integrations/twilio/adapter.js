// Twilio adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'twilio',
  name: "Twilio",
  kind: 'sms',
  category: 'sms',
  status: 'coming_soon',
  authType: 'pat',
  description: "Send SMS reminders for events and bookings.",
  docsUrl: "https://www.twilio.com/docs",
  recommended: false,
});
