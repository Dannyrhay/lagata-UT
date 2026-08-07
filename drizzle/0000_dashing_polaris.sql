CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`edit_token_hash` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
