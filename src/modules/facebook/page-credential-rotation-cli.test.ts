import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  runPageCredentialRotationCli,
  type RotationCliService,
} from "./page-credential-rotation-cli";

function setup(
  overrides: {
    rotate?: RotationCliService["rotate"];
    countByVersion?: RotationCliService["countByVersion"];
    countUserConnectionsByVersion?: RotationCliService["countUserConnectionsByVersion"];
  } = {},
) {
  const messages: string[] = [];
  const errors: string[] = [];
  const rotate =
    overrides.rotate ??
    vi
      .fn<RotationCliService["rotate"]>()
      .mockImplementation(async ({ dryRun }) => ({
        dryRun: dryRun ?? false,
        fromVersion: 1,
        toVersion: 2,
        credentialCount: 3,
        userConnectionCount: 2,
      }));
  const countByVersion =
    overrides.countByVersion ??
    vi.fn<RotationCliService["countByVersion"]>().mockResolvedValue(0);
  const countUserConnectionsByVersion =
    overrides.countUserConnectionsByVersion ??
    vi
      .fn<RotationCliService["countUserConnectionsByVersion"]>()
      .mockResolvedValue(0);

  return {
    messages,
    errors,
    rotate,
    countByVersion,
    countUserConnectionsByVersion,
    input: {
      service: {
        targetVersion: 2,
        rotate,
        countByVersion,
        countUserConnectionsByVersion,
      },
      output: {
        write: (message: string) => messages.push(message),
        writeError: (message: string) => errors.push(message),
      },
    },
  };
}

describe("Page credential rotation CLI", () => {
  it("runs dry-run only by default and reports source, target and count", async () => {
    const context = setup();

    await expect(
      runPageCredentialRotationCli({
        ...context.input,
        argv: ["--from-version=1"],
      }),
    ).resolves.toBe(0);

    expect(context.rotate).toHaveBeenCalledOnce();
    expect(context.rotate).toHaveBeenCalledWith({
      fromVersion: 1,
      dryRun: true,
    });
    expect(context.countByVersion).not.toHaveBeenCalled();
    expect(context.messages.join("\n")).toContain('"credentialCount":3');
    expect(context.messages.join("\n")).toContain('"userConnectionCount":2');
    expect(context.messages.join("\n")).toContain('"targetVersion":2');
  });

  it("executes only after dry-run and explicit target confirmation", async () => {
    const context = setup();

    await expect(
      runPageCredentialRotationCli({
        ...context.input,
        argv: [
          "--from-version",
          "1",
          "--execute",
          "--confirm-target-version=2",
        ],
      }),
    ).resolves.toBe(0);

    expect(vi.mocked(context.rotate).mock.calls).toEqual([
      [{ fromVersion: 1, dryRun: true }],
      [{ fromVersion: 1, dryRun: false }],
    ]);
    expect(context.countByVersion).toHaveBeenCalledWith(1);
    expect(context.countUserConnectionsByVersion).toHaveBeenCalledWith(1);
    expect(context.messages.join("\n")).toContain(
      '"remainingSourceVersionCredentials":0',
    );
  });

  it("returns non-zero and never prints token or key material on failure", async () => {
    const plaintext = "secret-page-token-that-must-not-escape";
    const encryptionKey = "secret-base64-key-that-must-not-escape";
    const context = setup({
      rotate: vi.fn<RotationCliService["rotate"]>().mockRejectedValue(
        new AppError({
          code: "TOKEN_DECRYPTION_FAILED",
          message: "Không thể giải mã Page credential.",
          cause: new Error(`${plaintext}:${encryptionKey}`),
        }),
      ),
    });

    await expect(
      runPageCredentialRotationCli({
        ...context.input,
        argv: ["--from-version=1"],
      }),
    ).resolves.toBe(1);

    const output = [...context.messages, ...context.errors].join("\n");
    expect(output).toContain("TOKEN_DECRYPTION_FAILED");
    expect(output).not.toContain(plaintext);
    expect(output).not.toContain(encryptionKey);
  });

  it("fails verification when old-version credentials remain", async () => {
    const context = setup({
      countByVersion: vi
        .fn<RotationCliService["countByVersion"]>()
        .mockResolvedValue(2),
    });

    await expect(
      runPageCredentialRotationCli({
        ...context.input,
        argv: ["--from-version=1", "--execute", "--confirm-target-version=2"],
      }),
    ).resolves.toBe(1);
    expect(context.errors.join("\n")).toContain(
      "PAGE_CREDENTIAL_ROTATION_INCOMPLETE",
    );
  });

  it("fails verification when old-version App B user connections remain", async () => {
    const context = setup({
      countUserConnectionsByVersion: vi
        .fn<RotationCliService["countUserConnectionsByVersion"]>()
        .mockResolvedValue(1),
    });

    await expect(
      runPageCredentialRotationCli({
        ...context.input,
        argv: ["--from-version=1", "--execute", "--confirm-target-version=2"],
      }),
    ).resolves.toBe(1);
    expect(context.errors.join("\n")).toContain(
      "PAGE_CREDENTIAL_ROTATION_INCOMPLETE",
    );
  });
});
