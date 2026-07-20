CREATE TABLE `dataset` (
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`key` text NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`captured_at` integer NOT NULL,
	CONSTRAINT `dataset_pk` PRIMARY KEY(`organization_id`, `provider`, `key`, `source_id`)
);
--> statement-breakpoint
CREATE INDEX `dataset_organization_captured` ON `dataset` (`organization_id`,`captured_at`);