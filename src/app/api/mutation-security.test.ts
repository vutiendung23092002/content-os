import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiRoot = dirname(fileURLToPath(import.meta.url));

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts"
        ? [path]
        : [];
  });
}

const mutationExport = /^export async function (?:POST|PUT|PATCH|DELETE)\b/m;
const csrfOrMachineGuard =
  /assertSameOrigin|assertFacebookCronAccess|assertAssetCleanupAccess/;
const authorizationGuard =
  /assertRequestPageAccess|assertRequestPostAccess|assertInternalAccess|assertInternalAdminAccess|requireAdmin|assertFacebookCronAccess|assertAssetCleanupAccess|createSupabaseServerClient/;

describe("API mutation security audit", () => {
  const mutationRoutes = routeFiles(apiRoot).filter((path) =>
    mutationExport.test(readFileSync(path, "utf8")),
  );

  it.each(mutationRoutes.map((path) => [relative(apiRoot, path), path]))(
    "%s declares a CSRF or machine-auth boundary",
    (_name, path) => {
      expect(readFileSync(path, "utf8")).toMatch(csrfOrMachineGuard);
    },
  );

  it.each(mutationRoutes.map((path) => [relative(apiRoot, path), path]))(
    "%s declares an authorization boundary",
    (_name, path) => {
      expect(readFileSync(path, "utf8")).toMatch(authorizationGuard);
    },
  );
});
