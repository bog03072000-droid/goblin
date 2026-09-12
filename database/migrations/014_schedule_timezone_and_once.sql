-- Recurring-only, machine-local-time-only scheduling (012_profile_schedule.sql)
-- was a deliberate, documented minimal scope. Two real gaps that scope left
-- open: a user wanting "start this profile once at a specific future moment"
-- had no way to express that at all, and a user managing profiles across
-- time zones had to mentally convert every HH:MM into the machine's own
-- local time. schedule_mode distinguishes the two kinds of schedule a
-- profile can have; schedule_timezone is an IANA zone name (e.g.
-- "Europe/Kyiv") used only for interpreting schedule_time's HH:MM — NULL
-- keeps the existing behavior (the OS's own local time) so every profile
-- created before this migration keeps working identically, unchanged.
-- schedule_one_time_at is a real absolute UTC instant (ISO 8601), not a
-- wall-clock HH:MM — a one-time schedule doesn't need a time zone to
-- interpret it, since "this exact moment" means the same thing everywhere.
ALTER TABLE profiles ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE profiles ADD COLUMN schedule_timezone TEXT;
ALTER TABLE profiles ADD COLUMN schedule_one_time_at TEXT;
