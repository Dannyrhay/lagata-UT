import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tournaments = sqliteTable("tournaments", {
  id: text("id").primaryKey(),
  editTokenHash: text("edit_token_hash").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
