import { sql, type SQLWrapper } from "drizzle-orm";

/** Human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Escape SQL LIKE wildcards in user input so a literal `%` or `_` can't widen the match. */
export function escapeLikeInput(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `column LIKE '%…%' ESCAPE '\'` — the pattern must already be escaped with escapeLikeInput. */
export function likePattern(column: SQLWrapper, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
