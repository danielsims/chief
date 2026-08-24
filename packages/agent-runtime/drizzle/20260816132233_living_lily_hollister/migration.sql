CREATE TABLE `project_grant` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`capability` text NOT NULL,
	`constraint_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `project_grant_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `project_operation` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`project_id` text,
	`principal_type` text,
	`principal_id` text,
	`agent_id` text,
	`checkout_id` text,
	`branch` text,
	`operation` text NOT NULL,
	`result` text NOT NULL,
	`commit_hash` text,
	`correlation_id` text,
	`message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_provider_link` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_repository_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `project_provider_link_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `provider_connection` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`provider_id` text NOT NULL,
	`installation_id` text,
	`account_label` text,
	`secret_reference` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `provider_connection_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_grant_principal_capability` ON `project_grant` (`organization_id`,`project_id`,`principal_type`,`principal_id`,`capability`);--> statement-breakpoint
CREATE INDEX `project_grant_principal` ON `project_grant` (`organization_id`,`principal_id`);--> statement-breakpoint
CREATE INDEX `project_grant_project` ON `project_grant` (`organization_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `project_operation_timeline` ON `project_operation` (`organization_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `project_operation_principal` ON `project_operation` (`organization_id`,`principal_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_provider_link_project_connection` ON `project_provider_link` (`organization_id`,`project_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `project_provider_link_connection` ON `project_provider_link` (`organization_id`,`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connection_installation` ON `provider_connection` (`organization_id`,`installation_id`);--> statement-breakpoint
CREATE INDEX `provider_connection_status` ON `provider_connection` (`organization_id`,`status`);