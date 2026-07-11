CREATE TABLE `attention_items` (
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
CREATE INDEX `attention_workspace_status_idx` ON `attention_items` (`workspace_id`,`status`);