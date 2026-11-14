-- Question banks: ask some of a quiz's questions rather than all of them.
--
-- A quiz with `draw_size` set becomes a bank. Each learner is dealt that many
-- of its questions, so two people sitting the same quiz do not sit the same
-- paper. Null is the old behaviour and the default, so every quiz written
-- before this migration behaves exactly as it did.
--
-- MySQL has no ADD COLUMN IF NOT EXISTS, so this is written to be run once.
-- Re-running it errors on the duplicate column rather than corrupting
-- anything.

ALTER TABLE lms_quizzes ADD COLUMN draw_size int null;

-- The hand a learner was dealt, kept because it has to outlive the request.
--
-- A paper is fetched and submitted in two separate calls and the attempt row
-- does not exist until the second, so a draw made fresh on each read would
-- deal a different hand on a refresh and mark answers against questions
-- nobody was asked. The draw is written when the paper is first handed out,
-- reused while it is open, and stamped with attempt_id once it is spent.
--
-- VENDORED SEAM — user_id is varchar(20), matching the three columns
-- 0001_lms.sql already converted: this host's learners are `contacts`
-- (int unsigned), not `users` (uuid), so there is no DB-level foreign key
-- against them either. See VENDORED.md.
--
-- attempt_id carries no foreign key either. The PostgreSQL schema cascades
-- it from lms_quiz_attempts; nothing in this app deletes an attempt, so the
-- cascade has no path to fire, and it is set by the application in the same
-- statement that writes the attempt.
create table if not exists lms_quiz_draws (
  id           char(36) not null,
  quiz_id      char(36) not null,
  user_id      varchar(20) not null,
  question_ids json not null,
  drawn_at     timestamp(3) not null default current_timestamp(3),
  attempt_id   char(36) null,
  primary key (id),
  key lms_quiz_draws_open_idx (quiz_id, user_id, attempt_id),
  constraint lms_quiz_draws_quiz_fk foreign key (quiz_id) references lms_quizzes (id) on delete cascade
) engine = innodb default charset = utf8mb4;
