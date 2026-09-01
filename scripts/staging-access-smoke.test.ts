import { describe, expect, it, vi } from "vitest";
import { runStagingAccessSmoke } from "./staging-access-smoke-core.mjs";

const clientId = "test-cloudflare-client-id";
const clientSecret = "test-cloudflare-client-secret";

function smokeInput(overrides: Record<string, unknown> = {}) {
  return {
    deploymentEnvironment: "staging",
    baseUrlValue: "https://staging-social.vutiendung.io.vn",
    cloudflareAccessClientId: clientId,
    cloudflareAccessClientSecret: clientSecret,
    ...overrides,
  };
}

function responseFor(pathname: string) {
  if (pathname === "/api/health") return new Response(null, { status: 200 });
  if (pathname === "/posts") {
    return new Response(null, {
      status: 307,
      headers: { location: "/login" },
    });
  }
  if (pathname === "/api/auth/internal/login") {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 401 });
}

describe("staging access smoke", () => {
  it.each([
    [
      "client ID",
      { cloudflareAccessClientId: "" },
      "CLOUDFLARE_ACCESS_CLIENT_ID",
      clientSecret,
    ],
    [
      "client secret",
      { cloudflareAccessClientSecret: "" },
      "CLOUDFLARE_ACCESS_CLIENT_SECRET",
      clientId,
    ],
  ])(
    "fails closed before HTTP when the %s is missing",
    async (_label, override, missingName, presentCredential) => {
      const fetchImpl = vi.fn();
      const errors: string[] = [];

      const exitCode = await runStagingAccessSmoke({
        ...smokeInput(override),
        fetchImpl,
        writeOutput: vi.fn(),
        writeError: (message: string) => errors.push(message),
      });

      expect(exitCode).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(JSON.parse(errors[0])).toMatchObject({
        ok: false,
        code: "CLOUDFLARE_ACCESS_SERVICE_TOKEN_MISSING",
        names: [missingName],
      });
      expect(errors[0]).not.toContain(presentCredential);
    },
  );

  it("sends only the Cloudflare service token headers and preserves app expectations", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const output: string[] = [];
    const fetchImpl = vi.fn(async (input: URL, init: RequestInit) => {
      requests.push({ url: input, init });
      return responseFor(input.pathname);
    });

    const exitCode = await runStagingAccessSmoke({
      ...smokeInput(),
      fetchImpl,
      writeOutput: (message: string) => output.push(message),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(requests).toHaveLength(7);
    for (const request of requests) {
      expect(request.init).toMatchObject({
        redirect: "manual",
        headers: {
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
        },
      });
      expect(
        Object.keys(request.init.headers as Record<string, string>),
      ).toEqual(["CF-Access-Client-Id", "CF-Access-Client-Secret"]);
    }
    expect(JSON.parse(output[0])).toEqual({
      ok: true,
      checks: [
        { name: "health", status: 200, passed: true },
        { name: "protected_page", status: 307, passed: true },
        { name: "protected_api", status: 401, passed: true },
        { name: "admin_api", status: 401, passed: true },
        { name: "facebook_cron", status: 401, passed: true },
        { name: "asset_cleanup_cron", status: 401, passed: true },
        { name: "legacy_password_endpoint", status: 404, passed: true },
      ],
      failures: [],
    });
    expect(output[0]).not.toContain(clientId);
    expect(output[0]).not.toContain(clientSecret);
  });

  it("does not expose credentials in failed-check diagnostics", async () => {
    const output: string[] = [];

    const exitCode = await runStagingAccessSmoke({
      ...smokeInput(),
      fetchImpl: vi.fn(async () => new Response(null, { status: 403 })),
      writeOutput: (message: string) => output.push(message),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(output[0]).not.toContain(clientId);
    expect(output[0]).not.toContain(clientSecret);
    expect(JSON.parse(output[0])).toMatchObject({ ok: false });
  });

  it("rejects a Cloudflare login redirect as an application login result", async () => {
    const output: string[] = [];
    const cloudflareLogin =
      "https://team.cloudflareaccess.com/cdn-cgi/access/login/staging-social.vutiendung.io.vn";

    const exitCode = await runStagingAccessSmoke({
      ...smokeInput(),
      fetchImpl: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: cloudflareLogin },
          }),
      ),
      writeOutput: (message: string) => output.push(message),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(output[0])).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        { name: "protected_page", status: 302, passed: false },
      ]),
      failures: expect.arrayContaining(["protected_page"]),
    });
    expect(output[0]).not.toContain(cloudflareLogin);
    expect(output[0]).not.toContain(clientId);
    expect(output[0]).not.toContain(clientSecret);
  });
});
