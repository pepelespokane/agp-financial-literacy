-- AGP Live Trivia — schema update 2026-04-19
-- Paste this into Supabase → SQL Editor → New query → Run.
--
-- WHY: the host was writing question_started_at using new Date().toISOString()
-- from the laptop's clock. If the laptop's clock drifts ahead of real UTC by
-- more than a few seconds, the scoring function sees submitted_at < v_started_at
-- and assigns every correct answer the maximum 1000 points. This RPC forces
-- question_started_at to come from the DB's now() so it's always server-authoritative.
--
-- Safe to re-run. Replaces any prior definition of start_question.

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
