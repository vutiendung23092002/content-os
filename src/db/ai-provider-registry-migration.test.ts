import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0011_ai_provider_registry.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
) as { entries: Array<{ tag: string }> };
const snapshot = JSON.parse(
  readFileSync(resolve(root, "drizzle/meta/0011_snapshot.json"), "utf8"),
) as {
  tables: Record<
    string,
    {
      columns: Record<string, unknown>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, unknown>;
    }
  >;
};

describe("AI provider registry migration", () => {
  it("has generated metadata and additive AI schema", () => {
    expect(
      journal.entries.some(
        (entry) => entry.tag === "0011_ai_provider_registry",
      ),
    ).toBe(true);
    expect(migration).not.toMatch(
      /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/,
    );
    for (const table of ["ai_providers", "ai_models", "ai_task_bindings"])
      expect(snapshot.tables[`hancontent_os.${table}`]).toBeDefined();
    for (const column of [
      "actor_user_id",
      "provider_id",
      "model_id",
      "output_data",
      "duration_ms",
    ])
      expect(
        snapshot.tables["hancontent_os.ai_generations"]?.columns[column],
      ).toBeDefined();
    expect(
      Object.keys(
        snapshot.tables["hancontent_os.ai_models"]?.foreignKeys ?? {},
      ),
    ).not.toHaveLength(0);
    expect(
      Object.keys(snapshot.tables["hancontent_os.ai_models"]?.indexes ?? {}),
    ).not.toHaveLength(0);
  });
});
