CREATE TABLE IF NOT EXISTS `mobile_share_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mobile_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mobile_shares_payload_hash_unique`
ON `mobile_shares` (`payload_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mobile_share_creation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`device_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mobile_share_events_created`
ON `mobile_share_creation_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mobile_share_events_ip_created`
ON `mobile_share_creation_events` (`ip_hash`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mobile_share_events_device_created`
ON `mobile_share_creation_events` (`device_hash`, `created_at`);
