ALTER TYPE "public"."notification_type" ADD VALUE 'article_shared_member_added';--> statement-breakpoint
CREATE INDEX "article_likes_user_id_idx" ON "article_likes" USING btree ("user_id");