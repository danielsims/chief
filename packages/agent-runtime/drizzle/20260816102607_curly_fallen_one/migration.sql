CREATE TABLE `checkout` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_identity` text NOT NULL,
	`session_id` text,
	`strategy` text NOT NULL,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_ref` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `checkout_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `binding` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`kind` text NOT NULL,
	`repository_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `binding_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `project` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`repository_kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`canonical_remote_url` text,
	`repository_web_url` text,
	`default_branch` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `project_pk` PRIMARY KEY(`organization_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_checkout_organization_path` ON `checkout` (`organization_id`,`runtime_id`,`path`);--> statement-breakpoint
CREATE INDEX `project_checkout_project_status` ON `checkout` (`organization_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_checkout_agent` ON `checkout` (`organization_id`,`agent_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_binding_runtime_project` ON `binding` (`organization_id`,`runtime_id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_binding_runtime_path` ON `binding` (`organization_id`,`runtime_id`,`repository_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_organization_remote` ON `project` (`organization_id`,`canonical_remote_url`);--> statement-breakpoint
CREATE INDEX `project_organization_updated` ON `project` (`organization_id`,`updated_at`);
