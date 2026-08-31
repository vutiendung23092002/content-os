import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const secretEnvironmentNames = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_PREVIOUS_KEYS",
  "APP_ACCESS_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ASSET_CLEANUP_SECRET",
  "FACEBOOK_CRON_SECRET",
];
const findings = [];

function inspectText(file, text, scope) {
  const safePath = relative(root, file).replaceAll("\\", "/");
  const rules = [
    ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
    ["JWT", /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/],
    ["META_TOKEN", /\bEA[A-Za-z0-9]{40,}\b/],
    [
      "DATABASE_CREDENTIAL",
      /postgres(?:ql)?:\/\/(?!user:password@host)[^\s<]+:[^\s<]+@[^\s<]+/i,
    ],
  ];

  for (const [rule, pattern] of rules) {
    if (pattern.test(text)) findings.push({ scope, file: safePath, rule });
  }

  for (const name of secretEnvironmentNames) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8 && text.includes(value)) {
      findings.push({ scope, file: safePath, rule: `ENV_VALUE:${name}` });
    }
  }
}

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

for (const trackedPath of tracked) {
  const file = join(root, trackedPath);
  if (!existsSync(file) || statSync(file).size > 5_000_000) continue;
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  inspectText(file, content.toString("utf8"), "tracked");
}

const clientRoot = join(root, ".next", "static");
if (!existsSync(clientRoot)) {
  findings.push({
    scope: "client_build",
    file: ".next/static",
    rule: "CLIENT_BUILD_MISSING",
  });
} else {
  const pending = [clientRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && statSync(path).size <= 5_000_000) {
        inspectText(path, readFileSync(path, "utf8"), "client_build");
      }
    }
  }
}

const uniqueFindings = [
  ...new Map(
    findings.map((finding) => [JSON.stringify(finding), finding]),
  ).values(),
];
console.log(
  JSON.stringify({
    ok: uniqueFindings.length === 0,
    trackedFilesScanned: tracked.length,
    clientBuildScanned: existsSync(clientRoot),
    findings: uniqueFindings,
  }),
);
if (uniqueFindings.length > 0) process.exitCode = 1;
