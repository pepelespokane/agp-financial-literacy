-- AGP Live Trivia — Supabase schema
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run: everything uses `if not exists` or `drop ... if exists` then recreate.

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists games (
  id              text primary key,
  name            text not null,
  status          text not null default 'lobby',     -- 'lobby' | 'active' | 'finished'
  current_question_id integer,                       -- null until host reveals first question
  question_phase  text not null default 'waiting',   -- 'waiting' | 'answering' | 'closed' | 'results'
  question_started_at timestamptz,                   -- when current question was revealed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  game_id         text not null references games(id) on delete cascade,
  name            text not null,
  sport           text,
  score           integer not null default 0,
  joined_at       timestamptz not null default now()
);

create index if not exists players_game_id_idx on players(game_id);
create index if not exists players_score_idx on players(game_id, score desc);

create table if not exists answers (
  id              uuid primary key default gen_random_uuid(),
  game_id         text not null references games(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  question_id     integer not null,
  answer_index    integer not null,                  -- 0-3 for A/B/C/D
  is_correct      boolean not null,
  points_earned   integer not null default 0,
  time_to_answer_ms integer,                         -- for speed bonus / analytics
  submitted_at    timestamptz not null default now(),
  unique (game_id, player_id, question_id)           -- one answer per player per question
);

create index if not exists answers_game_q_idx on answers(game_id, question_id);

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================
-- Wide-open policies: this app has no auth. Acceptable for a one-time event
-- with a short-lived, non-public game_id. Do NOT reuse this architecture for
-- anything where cheating or impersonation would matter.

alter table games   enable row level security;
alter table players enable row level security;
alter table answers enable row level security;

drop policy if exists "public read games" on games;
drop policy if exists "public write games" on games;
create policy "public read games"  on games for select using (true);
create policy "public write games" on games for all    using (true) with check (true);

drop policy if exists "public read players" on players;
drop policy if exists "public write players" on players;
create policy "public read players"  on players for select using (true);
create policy "public write players" on players for all    using (true) with check (true);

drop policy if exists "public read answers" on answers;
drop policy if exists "public write answers" on answers;
create policy "public read answers"  on answers for select using (true);
create policy "public write answers" on answers for all    using (true) with check (true);

-- =============================================================================
-- Realtime — add tables to the supabase_realtime publication
-- =============================================================================
-- This is what makes websocket subscriptions work. Supabase sometimes
-- auto-adds tables to the publication at creation, so we guard each add
-- against the "already member" error.

do $$ begin
  alter publication supabase_realtime add table games;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table players;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table answers;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- Seed the Gonzaga game
-- =============================================================================

insert into games (id, name, status, question_phase)
values ('gonzaga-2026-04-20', 'Gonzaga — Your Money Playbook', 'lobby', 'waiting')
on conflict (id) do nothing;

-- =============================================================================
-- score_question: bulk scoring function
-- =============================================================================
-- Called by the host when revealing results. Does in one round-trip what the
-- old host.js loop did in 2-3 round-trips per player. For 200 players this is
-- the difference between ~30 seconds (serial) and <1 second (bulk).
--
-- Uses the same piecewise-linear point decay as the JS pointsForElapsed():
--   0–8s    : 1000 pts (reading window)
--   8–15s   : 1000 → 500 (linear)
--   15–20s  : 500 → 250 (linear)
--   20–25s  : 250 → 1 (linear)
--   >25s    : 0
-- Only is_correct=true answers earn points.

-- start_question: server-authoritative question advance.
-- Host-laptop clock drift would otherwise propagate into question_started_at
-- and make the scoring function assign 1000 points to every correct answer.
-- Using now() forces the timestamp to come from the DB server's clock.

create or replace function start_question(
  p_game_id     text,
  p_question_id integer
)
returns void
language plpgsql
as $$
begin
  update games
  set
    status              = 'active',
    current_question_id = p_question_id,
    question_phase      = 'answering',
    question_started_at = now()
  where id = p_game_id;
end;
$$;

create or replace function score_question(
  p_game_id     text,
  p_question_id integer
)
returns void
language plpgsql
as $$
declare
  v_started_at timestamptz;
begin
  select question_started_at into v_started_at
    from games where id = p_game_id;

  if v_started_at is null then
    return;
  end if;

  -- Step 1: set points_earned + time_to_answer_ms on every answer for this question
  update answers a
  set
    time_to_answer_ms = round(extract(epoch from (a.submitted_at - v_started_at)) * 1000)::integer,
    points_earned = case
      when not a.is_correct then 0
      when extract(epoch from (a.submitted_at - v_started_at)) <= 8 then 1000
      when extract(epoch from (a.submitted_at - v_started_at)) <= 15 then
        round(1000 - (extract(epoch from (a.submitted_at - v_started_at)) - 8) * (500.0 / 7))::integer
      when extract(epoch from (a.submitted_at - v_started_at)) <= 20 then
        round(500 - (extract(epoch from (a.submitted_at - v_started_at)) - 15) * (250.0 / 5))::integer
      when extract(epoch from (a.submitted_at - v_started_at)) <= 25 then
        round(250 - (extract(epoch from (a.submitted_at - v_started_at)) - 20) * (249.0 / 5))::integer
      else 0
    end
  where a.game_id = p_game_id
    and a.question_id = p_question_id;

  -- Step 2: bump each player's running score by what they earned on this question
  update players p
  set score = p.score + a.points_earned
  from answers a
  where a.game_id = p_game_id
    and a.question_id = p_question_id
    and a.player_id = p.id
    and a.points_earned > 0;
end;
$$;
