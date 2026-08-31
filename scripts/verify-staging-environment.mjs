import { validateStagingEnvironment } from "./staging-readiness-core.mjs";

const result = validateStagingEnvironment(process.env);
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
