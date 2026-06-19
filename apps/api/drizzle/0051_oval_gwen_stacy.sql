CREATE TABLE "weather_areas" (
	"office_code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"center_code" text NOT NULL,
	"center_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_code" text NOT NULL,
	"forecast_date" date NOT NULL,
	"weather_code" text NOT NULL,
	"pop" integer,
	"temp_min" integer,
	"temp_max" integer,
	"reliability" text,
	"report_datetime" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weather_forecasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "weather_forecasts" ADD CONSTRAINT "weather_forecasts_office_code_weather_areas_office_code_fk" FOREIGN KEY ("office_code") REFERENCES "public"."weather_areas"("office_code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weather_forecasts_office_date_unique" ON "weather_forecasts" USING btree ("office_code","forecast_date");--> statement-breakpoint
CREATE INDEX "weather_forecasts_office_idx" ON "weather_forecasts" USING btree ("office_code");