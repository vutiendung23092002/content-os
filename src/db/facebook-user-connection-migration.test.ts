import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = { entries: Array<{ tag: string }> };
type SnapshotTable = {
  columns: Record<string, unknown>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
};
type Snapshot = {
  tables: Record<string, SnapshotTable>;
  enums: Record<string, { values: string[] }>;
};

const migrationPath = join(
  process.cwd(),
  "drizzle",
  "0008_remarkable_garia.sql",
);
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
const snapshotPath = join(
  process.cwd(),
  "drizzle",
  "meta",
  "0008_snapshot.json",
);
const credentialMetadataMigrationPath = join(
  process.cwd(),
  "drizzle",
  "0009_aspiring_black_tom.sql",
);
const latestSnapshotPath = join(
  process.cwd(),
  "drizzle",
  "meta",
  "0009_snapshot.json",
);

describe("per-user Facebook connection migration contract", () => {
  it("is additive and preserves legacy credentials while adding provenance", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'CREATE TYPE "hancontent_os"."facebook_connection_type"',
    );
    expect(sql).toContain(
      'CREATE TABLE "hancontent_os"."facebook_oauth_states"',
    );
    expect(sql).toContain(
      'ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "app_user_id" uuid',
    );
    expect(sql).toContain(
      'ALTER TABLE "hancontent_os"."page_credentials" ADD COLUMN "facebook_connection_id" uuid',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "page_credentials_legacy_page_unique"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "page_credentials_page_connection_unique"',
    );
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/);
    expect(sql).not.toContain("access_token_ciphertext =");
  });

  it("is registered with the expected relational and state constraints", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
    const connection = snapshot.tables["hancontent_os.facebook_connection"];
    const oauthState = snapshot.tables["hancontent_os.facebook_oauth_states"];
    const credential = snapshot.tables["hancontent_os.page_credentials"];
    const assignment = snapshot.tables["hancontent_os.user_page_assignments"];

    expect(journal.entries.map((entry) => entry.tag)).toContain(
      "0008_remarkable_garia",
    );
    expect(
      snapshot.enums["hancontent_os.facebook_connection_type"]?.values,
    ).toEqual(["admin_managed", "user_connected"]);
    expect(connection!.indexes).toHaveProperty(
      "facebook_connection_user_app_type_unique",
    );
    expect(connection!.checkConstraints).toHaveProperty(
      "facebook_connection_user_connected_fields",
    );
    expect(oauthState!.columns).toHaveProperty("state_hash");
    expect(oauthState!.indexes).toHaveProperty(
      "facebook_oauth_states_expiry_idx",
    );
    expect(oauthState!.foreignKeys).toHaveProperty(
      "facebook_oauth_states_app_user_id_app_users_id_fk",
    );
    expect(credential!.columns).toHaveProperty("facebook_connection_id");
    expect(credential!.foreignKeys).toHaveProperty(
      "page_credentials_facebook_connection_id_facebook_connection_id_fk",
    );
    expect(assignment!.columns).toHaveProperty("facebook_connection_id");
    expect(assignment!.foreignKeys).toHaveProperty(
      "user_page_assignments_facebook_connection_id_facebook_connection_id_fk",
    );
  });

  it("stores connection-specific safe metadata with each Page credential", () => {
    const migration = readFileSync(credentialMetadataMigrationPath, "utf8");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const snapshot = JSON.parse(
      readFileSync(latestSnapshotPath, "utf8"),
    ) as Snapshot;

    expect(migration).toContain(
      "ADD COLUMN \"provider_metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL",
    );
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      "0009_aspiring_black_tom",
    );
    expect(
      snapshot.tables["hancontent_os.page_credentials"]?.columns,
    ).toHaveProperty("provider_metadata");
  });
});
