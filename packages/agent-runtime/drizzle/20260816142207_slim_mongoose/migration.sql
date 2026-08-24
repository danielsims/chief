CREATE TABLE `cell_alarm` (
	`cell_id` text NOT NULL,
	`alarm_id` text NOT NULL,
	`at` integer NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `cell_alarm_pk` PRIMARY KEY(`cell_id`, `alarm_id`)
);
--> statement-breakpoint
CREATE TABLE `cell_event` (
	`cell_id` text NOT NULL,
	`position` integer NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `cell_event_pk` PRIMARY KEY(`cell_id`, `position`)
);
--> statement-breakpoint
CREATE TABLE `cell_lease` (
	`cell_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cell_outbox` (
	`cell_id` text NOT NULL,
	`id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`delivered_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `cell_outbox_pk` PRIMARY KEY(`cell_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `cell_project_lease` (
	`cell_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`checkout_id` text,
	`branch` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `cell_project_lease_pk` PRIMARY KEY(`cell_id`, `lease_id`)
);
--> statement-breakpoint
CREATE TABLE `cell_state` (
	`cell_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `cell_state_pk` PRIMARY KEY(`cell_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `cell_alarm_due` ON `cell_alarm` (`cell_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cell_event_idempotency` ON `cell_event` (`cell_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `cell_event_timeline` ON `cell_event` (`cell_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `cell_outbox_idempotency` ON `cell_outbox` (`cell_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `cell_outbox_pending` ON `cell_outbox` (`cell_id`,`state`);--> statement-breakpoint
CREATE INDEX `cell_project_lease_due` ON `cell_project_lease` (`cell_id`,`expires_at`);