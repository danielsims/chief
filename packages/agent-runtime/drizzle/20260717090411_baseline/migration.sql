CREATE TABLE `preference` (
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`driver` text,
	`model` text,
	`capabilities` text,
	`integrations` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `preference_pk` PRIMARY KEY(`workspace_id`, `agent_id`)
);
--> statement-breakpoint
CREATE TABLE `attention` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`source_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campaign` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`objective` text,
	`status` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`budget` real,
	`spend` real,
	`revenue` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`trigger_id` text,
	`visibility` text NOT NULL,
	`agent` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`last_text` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`provider_state` text,
	`eve_state` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_chat_parent_id_chat_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `content` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`platform` text NOT NULL,
	`file_id` text,
	`status` text NOT NULL,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`metadata` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_message_chat_id_chat_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `prospect` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`source` text NOT NULL,
	`source_url` text,
	`summary` text NOT NULL,
	`relevance` text NOT NULL,
	`status` text NOT NULL,
	`found_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`run_once_at` integer,
	`status` text NOT NULL,
	`placement` text DEFAULT 'local' NOT NULL,
	`skip_dates` text,
	`approval_summary` text NOT NULL,
	`proposed_tool_patterns` text NOT NULL,
	`grant` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_schedule_chat_id_chat_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY,
	`schedule_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`summary` text,
	`error` text,
	`artifacts` text,
	`blocked_tools` text,
	CONSTRAINT `fk_run_schedule_id_schedule_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_chat_id_chat_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `trend` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`summary` text NOT NULL,
	`signal` text NOT NULL,
	`status` text NOT NULL,
	`found_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `version` (
	`id` text PRIMARY KEY,
	`file_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`content` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_version_file_id_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`current_version_id` text NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attention_workspace_status_idx` ON `attention` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_workspace_updated` ON `campaign` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chat_workspace_updated` ON `chat` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chat_parent` ON `chat` (`parent_id`);--> statement-breakpoint
CREATE INDEX `content_workspace_schedule` ON `content` (`workspace_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_chat_position` ON `message` (`chat_id`,`position`);--> statement-breakpoint
CREATE INDEX `message_chat_created` ON `message` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `prospect_workspace_found` ON `prospect` (`workspace_id`,`found_at`);--> statement-breakpoint
CREATE INDEX `schedule_workspace_next` ON `schedule` (`workspace_id`,`next_run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_chat` ON `schedule` (`chat_id`);--> statement-breakpoint
CREATE INDEX `run_workspace_started` ON `run` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_one_active_per_schedule` ON `run` (`schedule_id`) WHERE "run"."status" = 'running';--> statement-breakpoint
CREATE INDEX `trend_workspace_found` ON `trend` (`workspace_id`,`found_at`);--> statement-breakpoint
CREATE INDEX `version_file_created` ON `version` (`file_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_workspace_path` ON `file` (`workspace_id`,`path`);--> statement-breakpoint
CREATE INDEX `file_workspace_updated` ON `file` (`workspace_id`,`updated_at`);