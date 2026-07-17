CREATE TABLE `workspace_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`current_version_id` text NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_files_workspace_path` ON `workspace_files` (`workspace_id`,`path`);
--> statement-breakpoint
CREATE INDEX `workspace_files_workspace_updated` ON `workspace_files` (`workspace_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `workspace_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`content` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`source_agent_id` text,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `workspace_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_file_versions_file_created` ON `workspace_file_versions` (`file_id`,`created_at`);
