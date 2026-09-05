import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = { entries: Array<{ tag: string }> };
type Snapshot = {
  tables: Record<
    string,
    {
      columns: Record<string, { notNull: boolean }>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, unknown>;
    }
  >;
  enums: Record<string, { values: string[] }>;
};

const migrationTag = "0010_shiny_captain_america";
const migrationPath = join(process.cwd(), "drizzle", `${migrationTag}.sql`);
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
const snapshotPath = join(
  process.cwd(),
  "drizzle",
  "meta",
  "0010_snapshot.json",
);

describe("Facebook operation credential provenance migration", () => {
  it("adds only nullable relational provenance and never stores credential material", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'CREATE TYPE "hancontent_os"."facebook_credential_source"',
    );
    expect(sql).toContain(
      'ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "credential_source"',
    );
    expect(sql).toContain('ADD COLUMN "facebook_connection_id" uuid');
    expect(sql).toContain('ADD COLUMN "page_credential_id" uuid');
    expect(sql).toContain('ADD COLUMN "actor_user_id" uuid');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/);
    expect(sql).not.toMatch(
      /ciphertext|nonce|auth_tag|fingerprint|access_token/i,
    );
  });

  it("registers nullable columns, indexes, and foreign keys for legacy compatibility", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
    const operation = snapshot.tables["hancontent_os.facebook_operations"]!;

    expect(journal.entries.some((entry) => entry.tag === migrationTag)).toBe(
      true,
    );
    expect(
      snapshot.enums["hancontent_os.facebook_credential_source"]?.values,
    ).toEqual(["admin_managed", "user_connected", "legacy_admin"]);
    for (const column of [
      "credential_source",
      "facebook_connection_id",
      "page_credential_id",
      "actor_user_id",
    ]) {
      expect(operation.columns[column]?.notNull).toBe(false);
    }
    expect(operation.indexes).toHaveProperty(
      "facebook_operations_connection_idx",
    );
    expect(operation.indexes).toHaveProperty(
      "facebook_operations_credential_idx",
    );
    expect(operation.foreignKeys).toHaveProperty(
      "facebook_operations_facebook_connection_id_facebook_connection_id_fk",
    );
    expect(operation.foreignKeys).toHaveProperty(
      "facebook_operations_page_credential_id_page_credentials_id_fk",
    );
    expect(operation.foreignKeys).toHaveProperty(
      "facebook_operations_actor_user_id_app_users_id_fk",
    );
  });
});
