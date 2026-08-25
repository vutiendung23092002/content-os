import { describe, expect, it } from "vitest";
import { toSupabaseIdentityClaims } from "./identity-claims";

describe("toSupabaseIdentityClaims", () => {
  it("keeps the verified subject and email", () => {
    expect(
      toSupabaseIdentityClaims({
        sub: "google-user-id",
        email: "staff@example.com",
      }),
    ).toEqual({
      sub: "google-user-id",
      email: "staff@example.com",
    });
  });

  it.each([null, undefined, {}, { sub: "" }, { sub: 123 }])(
    "rejects malformed claims: %j",
    (claims) => {
      expect(toSupabaseIdentityClaims(claims)).toBeNull();
    },
  );

  it("ignores a malformed optional email", () => {
    expect(
      toSupabaseIdentityClaims({ sub: "google-user-id", email: 123 }),
    ).toEqual({ sub: "google-user-id" });
  });
});
