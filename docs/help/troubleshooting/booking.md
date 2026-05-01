---
title: Booking page slot issues
description: Why available slots might look wrong on a booking page
---

# Booking page slot issues

## "No times available" but my calendar is empty

Common causes:

### 1. Availability windows aren't set

Settings → Bookings → page → Availability → make sure each weekday has
at least one window (e.g. Mon-Fri 9am-5pm). A weekday with no window =
no slots that day.

### 2. Min notice is too long

If "Min notice" is set to "2 days" and you check today, no slots show
for today or tomorrow. Reduce min-notice in page settings.

### 3. Max advance is too short

If "Max advance" is "3 days" and someone checks 2 weeks out, they see
nothing. Bump max-advance to e.g. 60 days.

### 4. Daily max already hit

If "Daily max" is 3 and you have 3 confirmed bookings that day, no more
slots available. Adjust the cap or block off less.

### 5. Connected calendar shows you as busy

The page checks all calendars in the page's "Check calendars" list. If
any of those has a "transparent" busy block (e.g. an all-day reminder),
slots get hidden. Mark non-busy events as "Free" or "Transparent" in
the event editor.

## Wrong timezone on booking confirmations

We store all slot times in UTC. Display is in the invitee's chosen
timezone. If the confirmation email shows the wrong time:
- Check the invitee picked the right timezone in the picker
- Check the "Booking confirmation" workflow in page settings

## Slot width / duration

Slots increment by `slot_step_min` (default 15 min). To get half-hour
slots, set slot step to 30. To get exact-hour slots, set 60.

## Buffer time between bookings

Configure in page settings:
- Buffer before — protected time before each booking
- Buffer after — protected time after each booking

E.g. 30-min meeting + 15-min buffer-after = 45-min "real" slot reserved.

## When to contact support

If slots appear inconsistent — sometimes there, sometimes not, no clear
pattern — email support with:
- The booking page slug
- The date/time the issue happens
- Which calendar is connected
