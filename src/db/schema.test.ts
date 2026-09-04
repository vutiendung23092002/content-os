import { describe, expect, it } from "vitest";
import {
  applicationSchema,
  appRoleEnum,
  connectionStatusEnum,
  generationTypeEnum,
  facebookCredentialSourceEnum,
  facebookConnectionTypeEnum,
  operationStatusEnum,
  operationTypeEnum,
  postStatusEnum,
  postTypeEnum,
  schema,
  userApprovalStatusEnum,
} from "./schema";

describe("database schema", () => {
  it("isolates all application objects in hancontent_os", () => {
    expect(applicationSchema.schemaName).toBe("hancontent_os");
  });

  it("exports the minimal persisted modules", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "facebookConnection",
        "facebookOauthStates",
        "appUsers",
        "pages",
        "userPageAssignments",
        "pageCredentials",
        "posts",
        "facebookOperations",
        "aiGenerations",
        "syncCursors",
        "cronJobs",
        "mutationRateLimits",
      ]),
    );
  });

  it("pins workflow enums used by reconciliation", () => {
    expect(connectionStatusEnum.enumValues).toContain("permission_missing");
    expect(postStatusEnum.enumValues).toContain("uncertain");
    expect(postStatusEnum.enumValues).toContain("needs_attention");
    expect(postTypeEnum.enumValues).toEqual(["text", "image", "video"]);
    expect(operationTypeEnum.enumValues).toContain("schedule");
    expect(operationStatusEnum.enumValues).toContain("uncertain");
    expect(operationStatusEnum.enumValues).toContain("needs_attention");
    expect(generationTypeEnum.enumValues).toContain("rewrite");
    expect(appRoleEnum.enumValues).toEqual(["super_admin", "admin", "member"]);
    expect(userApprovalStatusEnum.enumValues).toContain("suspended");
    expect(facebookConnectionTypeEnum.enumValues).toEqual([
      "admin_managed",
      "user_connected",
    ]);
    expect(facebookCredentialSourceEnum.enumValues).toEqual([
      "admin_managed",
      "user_connected",
      "legacy_admin",
    ]);
  });
});
