ALTER TABLE `user` ADD COLUMN `username` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username` COLLATE NOCASE) WHERE `username` IS NOT NULL;
