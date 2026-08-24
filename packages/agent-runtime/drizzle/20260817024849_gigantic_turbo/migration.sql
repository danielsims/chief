CREATE TABLE `project_access_request` (
	`id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`capability` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	CONSTRAINT `project_access_request_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `project_access_request_pending` ON `project_access_request` (`organization_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `project_access_request_project` ON `project_access_request` (`organization_id`,`project_id`);