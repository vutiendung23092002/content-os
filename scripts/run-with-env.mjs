import { spawnSync } from "node:child_process";
import { loadExplicitEnvironment } from "./explicit-environment.mjs";

const separator = process.argv.indexOf("--");
const options = process.argv.slice(2, separator);
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
const envFile = options.find((value) => !value.startsWith("--"));
const expectation = options
  .find((value) => value.startsWith("--expect="))
  ?.slice("--expect=".length);

if (
  !envFile ||
  (expectation !== "production" && expectation !== "staging") ||
  command.length === 0
) {
  console.error(
    JSON.stringify({
      ok: false,
      code: "EXPLICIT_ENV_COMMAND_INVALID",
      required:
        "<env-file> --expect=production|staging -- <command> [arguments]",
    }),
  );
  process.exit(1);
}

const selected = loadExplicitEnvironment({
  cwd: process.cwd(),
  envFile,
  expect: expectation,
  inheritedEnvironment: process.env,
});
if (!selected.ok) {
  console.error(
    JSON.stringify({
      ok: false,
      event: "explicit_environment_rejected",
      failures: selected.failures,
    }),
  );
  process.exit(1);
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: selected.childEnvironment,
  stdio: "inherit",
  shell: false,
});
if (result.error) {
  console.error(
    JSON.stringify({
      ok: false,
      event: "explicit_environment_command_failed",
      code: result.error.code ?? "COMMAND_SPAWN_FAILED",
    }),
  );
}
process.exitCode = result.status ?? 1;
