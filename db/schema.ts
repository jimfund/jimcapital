import { integer, real, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const transfers = sqliteTable('transfers', { tokenHash: text('token_hash').primaryKey(), payload: text('payload').notNull(), expiresAt: integer('expires_at').notNull() });
export const articles = sqliteTable('articles', {
 id: text('id').primaryKey(), sourceId: text('source_id').notNull().unique(), slug: text('slug').notNull().unique(),
 draft: text('draft').notNull(), revision: integer('revision').notNull(), published: text('published'), publishedAt: integer('published_at'), updatedAt: integer('updated_at').notNull(),
});
export const versions = sqliteTable('article_versions', { articleId: text('article_id').notNull(), revision: integer('revision').notNull(), snapshot: text('snapshot').notNull(), createdAt: integer('created_at').notNull() }, t => [primaryKey({columns:[t.articleId,t.revision]})]);
export const marketCache = sqliteTable('market_cache', {
 key: text('key').primaryKey(), payload: text('payload'), expiresAt: integer('expires_at').notNull().default(0),
 leaseUntil: integer('lease_until').notNull().default(0), retryAt: integer('retry_at').notNull().default(0),
});
export const marketCandles = sqliteTable('market_candles', {
 series: text('series').notNull(), interval: text('interval').notNull(), time: integer('time').notNull(), close: real('close').notNull(),
}, t => [primaryKey({columns:[t.series,t.interval,t.time]})]);
