const expectedFacebookForeignKeys = [
  {
    sourceSchema: "hancontent_os",
    sourceTable: "facebook_oauth_states",
    sourceColumns: ["app_user_id"],
    targetSchema: "hancontent_os",
    targetTable: "app_users",
    targetColumns: ["id"],
    onDelete: "CASCADE",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "facebook_connection",
    sourceColumns: ["app_user_id"],
    targetSchema: "hancontent_os",
    targetTable: "app_users",
    targetColumns: ["id"],
    onDelete: "CASCADE",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "page_credentials",
    sourceColumns: ["facebook_connection_id"],
    targetSchema: "hancontent_os",
    targetTable: "facebook_connection",
    targetColumns: ["id"],
    onDelete: "RESTRICT",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "user_page_assignments",
    sourceColumns: ["facebook_connection_id"],
    targetSchema: "hancontent_os",
    targetTable: "facebook_connection",
    targetColumns: ["id"],
    onDelete: "SET NULL",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "facebook_operations",
    sourceColumns: ["facebook_connection_id"],
    targetSchema: "hancontent_os",
    targetTable: "facebook_connection",
    targetColumns: ["id"],
    onDelete: "RESTRICT",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "facebook_operations",
    sourceColumns: ["page_credential_id"],
    targetSchema: "hancontent_os",
    targetTable: "page_credentials",
    targetColumns: ["id"],
    onDelete: "SET NULL",
  },
  {
    sourceSchema: "hancontent_os",
    sourceTable: "facebook_operations",
    sourceColumns: ["actor_user_id"],
    targetSchema: "hancontent_os",
    targetTable: "app_users",
    targetColumns: ["id"],
    onDelete: "SET NULL",
  },
];

export function facebookForeignKeyLabel(foreignKey) {
  return `${foreignKey.sourceTable}.${foreignKey.sourceColumns.join(",")}->${foreignKey.targetTable}.${foreignKey.targetColumns.join(",")}:${foreignKey.onDelete}`;
}

function sameColumns(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((column, index) => column === expected[index])
  );
}

function sameForeignKey(actual, expected) {
  return (
    actual.sourceSchema === expected.sourceSchema &&
    actual.sourceTable === expected.sourceTable &&
    sameColumns(actual.sourceColumns, expected.sourceColumns) &&
    actual.targetSchema === expected.targetSchema &&
    actual.targetTable === expected.targetTable &&
    sameColumns(actual.targetColumns, expected.targetColumns) &&
    actual.onDelete === expected.onDelete
  );
}

export function findMissingFacebookForeignKeys(actualForeignKeys) {
  return expectedFacebookForeignKeys
    .filter(
      (expected) =>
        !actualForeignKeys.some((actual) => sameForeignKey(actual, expected)),
    )
    .map(facebookForeignKeyLabel);
}

export { expectedFacebookForeignKeys };
