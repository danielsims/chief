CREATE TABLE `browser` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`parent_conversation_id` text,
	`thread_root_id` text,
	`anchor_message_id` text,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_browser_conversation_id_session_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `browser_organization_conversation` ON `browser` (`organization_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `browser_active` ON `browser` (`organization_id`,`status`);