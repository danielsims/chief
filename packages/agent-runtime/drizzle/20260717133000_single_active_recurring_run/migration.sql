-- Older runtime builds could leave several live attempts for one recurring
-- job. Preserve the newest attempt and close the rest before adding the
-- database-enforced scheduler lease.
UPDATE recurring_work_runs AS candidate
SET
  status = 'failed',
  finished_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
  summary = 'A newer attempt replaced this overlapping run. Nothing external was assumed to have completed.',
  error = 'Chief closed a duplicate active run during scheduler recovery.'
WHERE candidate.status = 'running'
  AND candidate.id <> (
    SELECT newest.id
    FROM recurring_work_runs AS newest
    WHERE newest.recurring_work_id = candidate.recurring_work_id
      AND newest.status = 'running'
    ORDER BY newest.started_at DESC, newest.id DESC
    LIMIT 1
  );

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS recurring_runs_one_active_per_work
  ON recurring_work_runs (recurring_work_id)
  WHERE status = 'running';
