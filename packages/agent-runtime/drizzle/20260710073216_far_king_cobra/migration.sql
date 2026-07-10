CREATE TABLE `agent_preferences` (
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`driver` text,
	`model` text,
	`capabilities` text,
	`integrations` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `agent_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_events` (
	`chat_id` text NOT NULL,
	`position` integer NOT NULL,
	`event_json` text NOT NULL,
	PRIMARY KEY(`chat_id`, `position`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`last_text` text DEFAULT '' NOT NULL,
	`driver` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chats_workspace_updated` ON `chats` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `content_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drafts_workspace_schedule` ON `content_drafts` (`workspace_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` text PRIMARY KEY NOT NULL,
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
CREATE INDEX `prospects_workspace_found` ON `prospects` (`workspace_id`,`found_at`);--> statement-breakpoint
CREATE TABLE `trends` (
	`id` text PRIMARY KEY NOT NULL,
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
CREATE INDEX `trends_workspace_found` ON `trends` (`workspace_id`,`found_at`);