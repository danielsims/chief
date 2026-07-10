CREATE TABLE `campaigns` (
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
CREATE INDEX `campaigns_workspace_updated` ON `campaigns` (`workspace_id`,`updated_at`);