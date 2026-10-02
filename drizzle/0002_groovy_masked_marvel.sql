CREATE TABLE `market_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_candles` (
	`series` text NOT NULL,
	`interval` text NOT NULL,
	`time` integer NOT NULL,
	`close` real NOT NULL,
	PRIMARY KEY(`series`, `interval`, `time`)
);
