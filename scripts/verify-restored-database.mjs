import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { resolveRestoreVerificationEnvironment } from "./staging-readiness-core.mjs";

const resolved = resolveRestoreVerificationEnvironment(process.env);
if (!resolved.ok) {
  console.error(
    JSON.stringify({
      ok: false,
      event: "isolated_restore_verification_rejected",
      failures: resolved.failures,
    }),
  );
  process.exit(1);
}

const commands = [
  [resolve("scripts/verify-database-schema.mjs")],
  [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    "src/db/repositories/repositories.integration.test.ts",
    "src/db/repositories/cron-job-repository.integration.test.ts",
  ],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: resolved.childEnvironment,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      JSON.stringify({
        ok: false,
        event: "isolated_restore_verification_failed",
        code: result.error?.code ?? "VERIFICATION_COMMAND_FAILED",
      }),
    );
    process.exit(result.status ?? 1);
  }
}

console.log(
  JSON.stringify({ ok: true, event: "isolated_restore_verification_passed" }),
);
