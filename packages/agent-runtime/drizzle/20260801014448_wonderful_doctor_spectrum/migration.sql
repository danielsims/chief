CREATE TABLE `post` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`protocol` text NOT NULL,
	`kind` integer NOT NULL,
	`pubkey` text NOT NULL,
	`tags` text NOT NULL,
	`content` text NOT NULL,
	`parts` text,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channel` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`protocol` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`agent_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `channel_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `post_timeline` ON `post` (`organization_id`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_organization_slug` ON `channel` (`organization_id`,`slug`);