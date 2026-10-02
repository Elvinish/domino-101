CREATE TABLE "room_chat" (
	"room_id" varchar(32) PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_commands" (
	"room_id" varchar(32) NOT NULL,
	"player_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "room_commands_room_id_player_id_command_id_pk" PRIMARY KEY("room_id","player_id","command_id"),
	CONSTRAINT "command_position_check" CHECK ("room_commands"."position" between 0 and 127),
	CONSTRAINT "command_fingerprint_check" CHECK ("room_commands"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "room_players" (
	"room_id" varchar(32) NOT NULL,
	"player_id" uuid NOT NULL,
	"display_name" varchar(32) NOT NULL,
	"seat" integer NOT NULL,
	"token_hash" varchar(64),
	CONSTRAINT "room_players_room_id_player_id_pk" PRIMARY KEY("room_id","player_id"),
	CONSTRAINT "player_seat_check" CHECK ("room_players"."seat" between 0 and 3),
	CONSTRAINT "player_token_hash_check" CHECK ("room_players"."token_hash" is null or "room_players"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "room_records" (
	"room_id" varchar(32) PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"lifecycle" varchar(16) NOT NULL,
	"match_id" uuid,
	"match_state" jsonb,
	"persistence_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "room_revision_check" CHECK ("room_records"."revision" >= 1 and "room_records"."revision" <= 9007199254740991),
	CONSTRAINT "room_lifecycle_check" CHECK ("room_records"."lifecycle" in ('lobby', 'playing', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "room_chat" ADD CONSTRAINT "room_chat_room_id_room_records_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room_records"("room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_commands" ADD CONSTRAINT "room_commands_room_id_player_id_room_players_room_id_player_id_fk" FOREIGN KEY ("room_id","player_id") REFERENCES "public"."room_players"("room_id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_room_records_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room_records"("room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_command_position_idx" ON "room_commands" USING btree ("room_id","player_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "room_player_seat_idx" ON "room_players" USING btree ("room_id","seat");--> statement-breakpoint
CREATE INDEX "room_expiry_idx" ON "room_records" USING btree ("expires_at");