import { type SQLWrapper, sql } from "drizzle-orm";

/** Human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Narrow an unknown to a plain record before reading its fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Escape SQL LIKE wildcards in user input so a literal `%` or `_` can't widen the match. */
export function escapeLikeInput(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `column LIKE '%…%' ESCAPE '\'` — the pattern must already be escaped with escapeLikeInput. */
export function likePattern(column: SQLWrapper, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/** `%<value>%` with LIKE wildcards escaped — the pattern likePattern's second argument expects. */
export function likeContains(value: string): string {
  return `%${escapeLikeInput(value)}%`;
}
