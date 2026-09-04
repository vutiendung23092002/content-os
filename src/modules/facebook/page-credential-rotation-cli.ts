import "server-only";

import { AppError } from "@/lib/errors/app-error";
import type {
  PageCredentialRotationResult,
  PageCredentialRotationService,
} from "./rotate-page-credentials";

export type RotationCliService = Pick<
  PageCredentialRotationService,
  | "targetVersion"
  | "rotate"
  | "countByVersion"
  | "countUserConnectionsByVersion"
>;

type RotationCliOutput = {
  write(message: string): void;
  writeError(message: string): void;
};

function optionValue(argv: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveVersion(value: string | undefined, option: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version <= 0) {
    throw new AppError({
      code: "INVALID_ROTATION_ARGUMENT",
      message: `${option} phải là số nguyên dương.`,
      status: 400,
    });
  }
  return version;
}

function safeFailure(error: unknown): { code: string; message: string } {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : {
        code: "PAGE_CREDENTIAL_ROTATION_FAILED",
        message:
          "Page credential rotation thất bại; xem server diagnostics an toàn.",
      };
}

function report(
  output: RotationCliOutput,
  event: string,
  details: Record<string, unknown>,
) {
  output.write(JSON.stringify({ event, ...details }));
}

export async function runPageCredentialRotationCli(input: {
  argv: string[];
  service: RotationCliService;
  output?: RotationCliOutput;
}): Promise<number> {
  const output = input.output ?? {
    write: (message) => console.log(message),
    writeError: (message) => console.error(message),
  };

  try {
    const fromVersion = positiveVersion(
      optionValue(input.argv, "--from-version"),
      "--from-version",
    );
    const execute = input.argv.includes("--execute");
    const confirmedTarget = optionValue(input.argv, "--confirm-target-version");
    const targetVersion = input.service.targetVersion;

    report(output, "rotation_plan", {
      mode: execute ? "execute" : "dry-run",
      sourceVersion: fromVersion,
      targetVersion,
    });

    const dryRun = await input.service.rotate({
      fromVersion,
      dryRun: true,
    });
    report(output, "rotation_dry_run_succeeded", {
      sourceVersion: dryRun.fromVersion,
      targetVersion: dryRun.toVersion,
      credentialCount: dryRun.credentialCount,
      userConnectionCount: dryRun.userConnectionCount,
    });

    if (!execute) {
      report(output, "rotation_not_executed", {
        instruction:
          "Re-run with --execute and --confirm-target-version after reviewing dry-run output.",
      });
      return 0;
    }

    if (
      positiveVersion(confirmedTarget, "--confirm-target-version") !==
      targetVersion
    ) {
      throw new AppError({
        code: "ROTATION_TARGET_CONFIRMATION_MISMATCH",
        message: "Target version xác nhận không khớp current key version.",
        status: 409,
      });
    }

    const rotated: PageCredentialRotationResult = await input.service.rotate({
      fromVersion,
      dryRun: false,
    });
    const remaining = await input.service.countByVersion(fromVersion);
    const remainingUserConnections =
      await input.service.countUserConnectionsByVersion(fromVersion);
    report(output, "rotation_execution_succeeded", {
      sourceVersion: rotated.fromVersion,
      targetVersion: rotated.toVersion,
      credentialCount: rotated.credentialCount,
      remainingSourceVersionCredentials: remaining,
      remainingSourceVersionUserConnections: remainingUserConnections,
    });

    if (remaining !== 0 || remainingUserConnections !== 0) {
      throw new AppError({
        code: "PAGE_CREDENTIAL_ROTATION_INCOMPLETE",
        message: "Vẫn còn credential Facebook ở source version sau rotation.",
        status: 500,
      });
    }
    report(output, "rotation_verification_succeeded", {
      sourceVersion: fromVersion,
      targetVersion,
      remainingSourceVersionCredentials: 0,
      remainingSourceVersionUserConnections: 0,
    });
    return 0;
  } catch (error) {
    const failure = safeFailure(error);
    output.writeError(JSON.stringify({ event: "rotation_failed", ...failure }));
    return 1;
  }
}
