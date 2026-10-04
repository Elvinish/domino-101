ALTER TABLE "room_players" ADD COLUMN "kind" varchar(5) DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "player_kind_check" CHECK ("room_players"."kind" in ('human', 'bot'));--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "bot_token_check" CHECK ("room_players"."kind" <> 'bot' or "room_players"."token_hash" is null);