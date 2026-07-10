CREATE TABLE `recurring_work` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text NOT NULL,
	`approval_summary` text NOT NULL,
	`proposed_tool_patterns` text NOT NULL,
	`grant` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_work_runs` (
	`id` text PRIMARY KEY,
	`recurring_work_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`summary` text,
	`error` text,
	CONSTRAINT `fk_recurring_work_runs_recurring_work_id_recurring_work_id_fk` FOREIGN KEY (`recurring_work_id`) REFERENCES `recurring_work`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `recurring_work_workspace_next` ON `recurring_work` (`workspace_id`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `recurring_runs_workspace_started` ON `recurring_work_runs` (`workspace_id`,`started_at`);