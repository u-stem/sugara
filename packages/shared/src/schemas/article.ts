import { z } from "zod";
import {
  ARTICLE_CONTENT_MAX_LENGTH,
  ARTICLE_TAG_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
  MAX_ARTICLES_PER_USER,
  MAX_TAGS_PER_ARTICLE,
  MAX_TRIPS_PER_ARTICLE,
} from "../limits";

export const articleVisibilitySchema = z.enum(["private", "friends_only", "public"]);
export type ArticleVisibility = z.infer<typeof articleVisibilitySchema>;

const tagsSchema = z
  .array(z.string().min(1).max(ARTICLE_TAG_MAX_LENGTH))
  .max(MAX_TAGS_PER_ARTICLE)
  .refine((arr) => new Set(arr).size === arr.length, "Duplicate tags are not allowed")
  .default([]);

export const createArticleSchema = z.object({
  title: z.string().min(1).max(ARTICLE_TITLE_MAX_LENGTH),
  content: z.string().max(ARTICLE_CONTENT_MAX_LENGTH).default(""),
  tags: tagsSchema,
  visibility: articleVisibilitySchema.default("private"),
});

export const updateArticleSchema = z.object({
  title: z.string().min(1).max(ARTICLE_TITLE_MAX_LENGTH).optional(),
  content: z.string().max(ARTICLE_CONTENT_MAX_LENGTH).optional(),
  tags: tagsSchema.optional(),
  visibility: articleVisibilitySchema.optional(),
});

export const reorderArticlesSchema = z.object({
  orderedIds: z
    .array(z.string().check(z.guid()))
    .max(MAX_ARTICLES_PER_USER)
    .refine((arr) => new Set(arr).size === arr.length, "Duplicate article IDs are not allowed"),
});

// Replace the full set of trips an article is linked to (idempotent PUT).
export const setArticleTripsSchema = z.object({
  tripIds: z
    .array(z.string().check(z.guid()))
    .max(MAX_TRIPS_PER_ARTICLE)
    .refine((arr) => new Set(arr).size === arr.length, "Duplicate trips are not allowed")
    .default([]),
});

// Batch operations on own articles (e.g. bulk delete).
export const batchArticleIdsSchema = z.object({
  articleIds: z
    .array(z.string().check(z.guid()))
    .min(1)
    .max(MAX_ARTICLES_PER_USER)
    .refine((arr) => new Set(arr).size === arr.length, "Duplicate article IDs are not allowed"),
});
export type BatchArticleIds = z.infer<typeof batchArticleIdsSchema>;
