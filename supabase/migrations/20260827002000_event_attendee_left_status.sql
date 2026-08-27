-- Room closeout, admin end, and account-deletion workflows move queued
-- attendees to this terminal state. Keep the enum aligned with those functions.
alter type public.event_attendee_status
  add value if not exists 'left';
