import { parseArgs } from "node:util";
import { runLocalCall, runLocalJob } from "./local-files.js";

const usage = [
  "npm run job:local -- --input <岗位需求文本> --out <输出目录>",
  "npm run call:local -- --zip <岗位资料ZIP> --guide <配套指南Markdown> --cv <简历TXT或PDF> --out <输出目录>",
].join("\n");

async function main(args: string[]) {
  const [command, ...flags] = args;
  if (command === "--help" || flags.length === 1 && flags[0] === "--help") {
    console.log(usage);
    return;
  }
  try {
    if (command === "job") {
      const { values: { input, out } } = parseArgs({ args: flags, options: { input: { type: "string" }, out: { type: "string" } } });
      if (!input || !out) throw new Error("local_usage_invalid");
      console.log(JSON.stringify(await runLocalJob({ input, out })));
    } else if (command === "call") {
      const { values: { zip, guide, cv, out } } = parseArgs({ args: flags, options: {
        zip: { type: "string" }, guide: { type: "string" }, cv: { type: "string" }, out: { type: "string" },
      } });
      if (!zip || !guide || !cv || !out) throw new Error("local_usage_invalid");
      console.log(JSON.stringify(await runLocalCall({ zip, guide, cv, out })));
    } else throw new Error("local_usage_invalid");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (message === "local_usage_invalid" || code?.startsWith("ERR_PARSE_ARGS_")) {
      console.error(usage);
      process.exitCode = 2;
      return;
    }
    const publicCode = /^(?:(?:local|job_import|call|cv)_[a-z_]+|invalid_analysis_(?:json|schema)|unexpected_codex_tool_activity)$/u.test(message)
      ? message : code === "ENOENT" ? "local_file_missing" : "local_run_failed";
    console.error(publicCode);
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
