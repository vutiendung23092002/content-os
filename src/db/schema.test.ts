import { describe, expect, it } from "vitest";
import {
  applicationSchema,
  connectionStatusEnum,
  generationTypeEnum,
  operationStatusEnum,
  operationTypeEnum,
  postStatusEnum,
  postTypeEnum,
  schema,
} from "./schema";

describe("database schema", () => {
  it("isolates all application objects in hancontent_os", () => {
    expect(applicationSchema.schemaName).toBe("hancontent_os");
  });

  it("exports the minimal persisted modules", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "facebookConnection",
        "pages",
        "pageCredentials",
        "posts",
        "facebookOperations",
        "aiGenerations",
        "syncCursors",
      ]),
    );
  });

  it("pins workflow enums used by reconciliation", () => {
    expect(connectionStatusEnum.enumValues).toContain("permission_missing");
    expect(postStatusEnum.enumValues).toContain("uncertain");
    expect(postTypeEnum.enumValues).toEqual(["text", "image"]);
    expect(operationTypeEnum.enumValues).toContain("schedule");
    expect(operationStatusEnum.enumValues).toContain("uncertain");
    expect(generationTypeEnum.enumValues).toContain("rewrite");
  });
});
