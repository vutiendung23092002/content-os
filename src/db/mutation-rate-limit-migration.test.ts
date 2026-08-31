import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = { entries: Array<{ tag: string }> };
type SnapshotTable = {
  columns: Record<string, unknown>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  compositePrimaryKeys: Record<string, unknown>;
};
type Snapshot = { tables: Record<string, SnapshotTable> };

const migrationPath = join(process.cwd(), "drizzle", "0007_magenta_sumo.sql");
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
const snapshotPath = join(
  process.cwd(),
  "drizzle",
  "meta",
  "0007_snapshot.json",
);

describe("mutation rate-limit migration contract", () => {
  it("creates the runtime table, composite key, actor FK and expiry index", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'CREATE TABLE "hancontent_os"."mutation_rate_limits"',
    );
    expect(sql).toContain(
      'PRIMARY KEY("actor_id","page_scope","action","window_start")',
    );
    expect(sql).toContain('REFERENCES "hancontent_os"."app_users"("id")');
    expect(sql).toContain("ON DELETE cascade");
    expect(sql).toContain('CREATE INDEX "mutation_rate_limits_expiry_idx"');
  });

  it("is registered in the Drizzle journal and snapshot", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
    const table = snapshot.tables["hancontent_os.mutation_rate_limits"];

    expect(journal.entries.at(-1)?.tag).toBe("0007_magenta_sumo");
    expect(table).toBeDefined();
    expect(Object.keys(table!.columns)).toEqual([
      "actor_id",
      "page_scope",
      "action",
      "window_start",
      "request_count",
      "expires_at",
      "updated_at",
    ]);
    expect(table!.compositePrimaryKeys).toHaveProperty(
      "mutation_rate_limits_actor_id_page_scope_action_window_start_pk",
    );
    expect(table!.foreignKeys).toHaveProperty(
      "mutation_rate_limits_actor_id_app_users_id_fk",
    );
    expect(table!.indexes).toHaveProperty("mutation_rate_limits_expiry_idx");
  });
});
