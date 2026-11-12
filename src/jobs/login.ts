import { recruitingCodexLogin } from "./codex.js";

if (!recruitingCodexLogin()) process.exitCode = 1;
