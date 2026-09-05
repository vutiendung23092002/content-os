import { describe, expect, it } from "vitest";
import {
  expectedFacebookForeignKeys,
  findMissingFacebookForeignKeys,
} from "./verify-database-schema-core.mjs";

const completeForeignKeys = expectedFacebookForeignKeys.map((foreignKey) => ({
  ...foreignKey,
  constraintName: `${foreignKey.sourceTable}_facebook_connection_id_facebook_connection_id_`,
}));

describe("Facebook schema foreign-key verification", () => {
  it("matches semantics even when PostgreSQL truncates the physical name", () => {
    expect(findMissingFacebookForeignKeys(completeForeignKeys)).toEqual([]);
  });

  it("rejects the same relationship with the wrong ON DELETE action", () => {
    const actual = completeForeignKeys.map((foreignKey) =>
      foreignKey.sourceTable === "page_credentials"
        ? { ...foreignKey, onDelete: "CASCADE" }
        : foreignKey,
    );

    expect(findMissingFacebookForeignKeys(actual)).toContain(
      "page_credentials.facebook_connection_id->facebook_connection.id:RESTRICT",
    );
  });

  it("rejects a relationship pointing to the wrong table or column", () => {
    const actual = completeForeignKeys.map((foreignKey) =>
      foreignKey.sourceTable === "facebook_operations" &&
      foreignKey.sourceColumns[0] === "page_credential_id"
        ? {
            ...foreignKey,
            targetTable: "app_users",
            targetColumns: ["id"],
          }
        : foreignKey,
    );

    expect(findMissingFacebookForeignKeys(actual)).toContain(
      "facebook_operations.page_credential_id->page_credentials.id:SET NULL",
    );
  });

  it("accepts a normally named short foreign key as well", () => {
    const actual = completeForeignKeys.map((foreignKey, index) =>
      index === 0 ? { ...foreignKey, constraintName: "short_fk" } : foreignKey,
    );

    expect(findMissingFacebookForeignKeys(actual)).toEqual([]);
  });

  it("does not depend on the physical constraint name", () => {
    const actual = completeForeignKeys.map((foreignKey) => ({
      ...foreignKey,
      constraintName: "unrelated_name",
    }));

    expect(findMissingFacebookForeignKeys(actual)).toEqual([]);
  });
});
