import { closeDatabase } from "../src/db/client";
import { runPageCredentialRotationCli } from "../src/modules/facebook/page-credential-rotation-cli";
import { PageCredentialRotationService } from "../src/modules/facebook/rotate-page-credentials";

let exitCode = 1;
try {
  exitCode = await runPageCredentialRotationCli({
    argv: process.argv.slice(2),
    service: new PageCredentialRotationService(),
  });
} catch {
  console.error(
    JSON.stringify({
      event: "rotation_failed",
      code: "ROTATION_CONFIGURATION_FAILED",
      message: "Không thể khởi tạo Page credential rotation an toàn.",
    }),
  );
}

await closeDatabase().catch(() => {
  process.exitCode = 1;
});
process.exitCode ??= exitCode;
