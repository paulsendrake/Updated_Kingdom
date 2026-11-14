-- Question banks: ask some of a quiz's questions rather than all of them.
--
-- A quiz with `draw_size` set becomes a bank. Each learner is dealt that many
-- of its questions, so two people sitting the same quiz do not sit the same
-- paper. Null is the old behaviour and the default, so every quiz written
-- before this migration behaves exactly as it did.

ALTER TABLE lms_quizzes ADD COLUMN IF NOT EXISTS draw_size integer;

-- The hand a learner was dealt, kept because it has to outlive the request.
--
-- A paper is fetched and submitted in two separate calls and the attempt row
-- does not exist until the second, so a draw made fresh on each read would
-- deal a different hand on a refresh and mark answers against questions
-- nobody was asked. The draw is written when the paper is first handed out,
-- reused while it is open, and stamped with attempt_id once it is spent.
CREATE TABLE IF NOT EXISTS lms_quiz_draws (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references lms_quizzes (id) on delete cascade,
  user_id      uuid not null,
  question_ids jsonb not null default '[]'::jsonb,
  drawn_at     timestamptz not null default now(),
  attempt_id   uuid references lms_quiz_attempts (id) on delete cascade
);

-- One lookup this table exists to serve: the open draw for this learner on
-- this quiz. attempt_id is in the key because "open" means it is null.
CREATE INDEX IF NOT EXISTS lms_quiz_draws_open_idx
  ON lms_quiz_draws (quiz_id, user_id, attempt_id);
