/**
 * SQL-building helpers for the raw better-sqlite3 stores (the drizzle side
 * doesn't need them). Column names are snake_case as in the schema; bind
 * parameters are the camelCase form of the column, so call sites pass plain
 * camelCase objects.
 */

/** snake_case column → camelCase bind-parameter name. */
function camelize(column: string): string {
  return column.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

export interface UpsertSpec {
  table: string;
  /** Conflict target; also inserted, never updated. */
  conflict: readonly string[];
  /** Inserted on first write, left alone on conflict (identity columns). */
  insertOnly?: readonly string[];
  /** Inserted and overwritten from `excluded` on conflict. */
  update: readonly string[];
  /**
   * Inserted, but on conflict updated as `COALESCE(excluded.col, table.col)`:
   * a null in the incoming row keeps the stored value. For columns a later
   * write may legitimately not re-supply (e.g. lazily-resolved List-Unsubscribe
   * headers a routine sync page doesn't re-capture), so a null never clobbers
   * a value another path resolved.
   */
  coalesceUpdate?: readonly string[];
}

/**
 * One INSERT … ON CONFLICT … DO UPDATE statement. `update` columns take the
 * excluded value; `coalesceUpdate` columns keep the stored value when the
 * excluded value is null. Columns not listed keep their schema defaults on
 * insert and their current value on conflict.
 */
export function upsertSql(spec: UpsertSpec): string {
  const coalesce = spec.coalesceUpdate ?? [];
  const columns = [...spec.conflict, ...(spec.insertOnly ?? []), ...spec.update, ...coalesce];
  const assignments = [
    ...spec.update.map((c) => `${c} = excluded.${c}`),
    ...coalesce.map((c) => `${c} = COALESCE(excluded.${c}, ${spec.table}.${c})`),
  ].join(",\n    ");
  return `
  INSERT INTO ${spec.table} (${columns.join(", ")})
  VALUES (${columns.map((c) => `@${camelize(c)}`).join(", ")})
  ON CONFLICT(${spec.conflict.join(", ")}) DO UPDATE SET
    ${assignments}
`;
}

/**
 * Turn free text into an FTS5 MATCH expression — every term quoted, joined
 * with AND or OR; null when the text has no searchable terms. Callers run
 * the AND form first and fall back to OR for recall.
 */
export function buildFtsMatch(query: string, operator: "AND" | "OR"): string | null {
  const terms = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12);
  if (!terms || terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(operator === "AND" ? " " : " OR ");
}
