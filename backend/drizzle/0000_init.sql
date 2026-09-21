CREATE TABLE "components" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"color" jsonb NOT NULL,
	"price" double precision NOT NULL,
	"width_m" double precision NOT NULL,
	"height_m" double precision NOT NULL,
	"depth_m" double precision NOT NULL,
	"style_tags" text[] NOT NULL,
	"model_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"price_per_unit" double precision NOT NULL,
	"applicable_surfaces" text[] NOT NULL,
	"style_tags" text[] NOT NULL,
	"subtype" text NOT NULL,
	"description" text NOT NULL,
	"color" jsonb NOT NULL,
	"texture" jsonb NOT NULL,
	"pbr" jsonb NOT NULL,
	"unit" text NOT NULL,
	"wastage_factor" double precision NOT NULL,
	"finish" text NOT NULL,
	"durability_score" integer NOT NULL,
	"sustainability_score" integer NOT NULL,
	"aesthetic_score" integer NOT NULL,
	"coverage_per_unit" double precision,
	"coats_recommended" integer,
	"pack_size" double precision,
	"pack_label" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit_system" text DEFAULT 'metric' NOT NULL,
	"contingency_buffer" double precision DEFAULT 0.08 NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"style_tags" text[] NOT NULL,
	"palette" text[] NOT NULL,
	"recommended" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "materials_category_idx" ON "materials" USING btree ("category");--> statement-breakpoint
CREATE INDEX "materials_tier_idx" ON "materials" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "materials_price_idx" ON "materials" USING btree ("price_per_unit");--> statement-breakpoint
CREATE INDEX "materials_surfaces_idx" ON "materials" USING gin ("applicable_surfaces");--> statement-breakpoint
CREATE INDEX "materials_style_tags_idx" ON "materials" USING gin ("style_tags");