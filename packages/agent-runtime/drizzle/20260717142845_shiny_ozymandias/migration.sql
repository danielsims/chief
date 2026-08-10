CREATE TABLE `action` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`source_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference` (
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`driver` text,
	`model` text,
	`capabilities` text,
	`integrations` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `preference_pk` PRIMARY KEY(`organization_id`, `agent_id`)
);
--> statement-breakpoint
CREATE TABLE `campaign` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
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
CREATE TABLE `content` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
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
CREATE TABLE `event` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`level` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_event_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`metadata` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `prospect` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
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
	`organization_id` text NOT NULL,
	`conversation_id` text,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`once_at` integer,
	`status` text NOT NULL,
	`placement` text DEFAULT 'local' NOT NULL,
	`skip_dates` text,
	`approval_summary` text NOT NULL,
	`proposed_tool_patterns` text NOT NULL,
	`grant` text,
	`next_at` integer,
	`last_completed_at` integer,
	`last_summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`parent_id` text,
	`trigger_id` text,
	`schedule_id` text,
	`kind` text NOT NULL,
	`visibility` text NOT NULL,
	`agent` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`last_text` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`provider_state` text,
	`eve_state` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`scheduled_for` integer,
	`started_at` integer,
	`finished_at` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`summary` text,
	`error` text,
	`artifacts` text,
	`blocked_tools` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_session_parent_id_session_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_schedule_id_schedule_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `trend` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
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
	`organization_id` text NOT NULL,
	`content` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_session_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_version_file_id_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`current_version_id` text NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_organization_status` ON `action` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_organization_updated` ON `campaign` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `content_organization_schedule` ON `content` (`organization_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_position` ON `event` (`session_id`,`position`);--> statement-breakpoint
CREATE INDEX `event_organization_session` ON `event` (`organization_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `event_session_created` ON `event` (`session_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_session_position` ON `message` (`session_id`,`position`);--> statement-breakpoint
CREATE INDEX `message_organization_session` ON `message` (`organization_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `message_session_created` ON `message` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `prospect_organization_found` ON `prospect` (`organization_id`,`found_at`);--> statement-breakpoint
CREATE INDEX `schedule_organization_next` ON `schedule` (`organization_id`,`next_at`);--> statement-breakpoint
CREATE INDEX `schedule_conversation` ON `schedule` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `session_organization_updated` ON `session` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `session_parent` ON `session` (`parent_id`);--> statement-breakpoint
CREATE INDEX `session_schedule_started` ON `session` (`schedule_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_schedule_occurrence` ON `session` (`schedule_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_one_active_per_schedule` ON `session` (`schedule_id`) WHERE "session"."status" IN ('running', 'waiting');--> statement-breakpoint
CREATE INDEX `trend_organization_found` ON `trend` (`organization_id`,`found_at`);--> statement-breakpoint
CREATE INDEX `version_file_created` ON `version` (`file_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_organization_path` ON `file` (`organization_id`,`path`);--> statement-breakpoint
CREATE INDEX `file_organization_updated` ON `file` (`organization_id`,`updated_at`);