import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./same-origin";

describe("same-origin guard", () => {
  it("accepts a matching origin behind the Cloudflare proxy", () => {
    const request = new Request(
      "http://127.0.0.1:3000/api/auth/internal/login",
      {
        headers: {
          origin: "https://content.example.com",
          "x-forwarded-host": "content.example.com",
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects missing and mismatched origins", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://content.example.com/api/auth/internal/login"),
      ),
    ).toThrow("Không xác minh được nguồn yêu cầu");

    expect(() =>
      assertSameOrigin(
        new Request("https://content.example.com/api/auth/internal/login", {
          headers: {
            host: "content.example.com",
            origin: "https://attacker.example",
          },
        }),
      ),
    ).toThrow("Yêu cầu khác nguồn đã bị từ chối");
  });
});
