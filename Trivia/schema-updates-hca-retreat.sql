-- AGP Live Trivia — HCA Instructor Retreat games
-- Paste into Supabase → SQL Editor → New query → Run.
-- Safe to re-run (uses on conflict do nothing).

insert into games (id, name, status, question_phase) values
  ('hca-retreat-day1', 'HCA Instructor Retreat — Spokane Trivia Day 1', 'lobby', 'waiting'),
  ('hca-retreat-day2', 'HCA Instructor Retreat — Spokane Trivia Day 2', 'lobby', 'waiting')
on conflict (id) do nothing;
