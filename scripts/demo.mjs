import { accessSync, constants, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function errorHint(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "demo_handoff_mismatch") return "岗位版本或电话包编号核对失败，请保留本次产物排查。";
  if (error?.code === "ERR_MODULE_NOT_FOUND") return "请在解压目录运行 npm ci，再运行 npm run demo。";
  if (error?.code === "ENOENT") return "请核对打包示例是否完整，以及输出目录是否仍然存在。";
  if (["EACCES", "EPERM", "ENOSPC", "EROFS"].includes(error?.code)) {
    return "请检查示例读取权限、output 目录写入权限和可用磁盘空间。";
  }
  if (/^(?:(?:local|job_import|call|cv)_[a-z_]+|invalid_analysis_(?:json|schema)|unexpected_codex_tool_activity)$/u.test(message)) {
    return `校验失败（${message}）。请核对当前步骤的样例、岗位交接文件或模型输出。`;
  }
  return "请运行 npm run login，或在 .env.local-recruiting 中检查 API Key 配置，同时确认网络可用。";
}

let step = "加载本地招聘程序";
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  process.chdir(root);
  const { runLocalJob, runLocalCall } = await import("../dist/src/jobs/local-files.js");

  const sampleDir = join(root, "samples", "input");
  const jd = join(sampleDir, "JD.txt");
  const cvA = join(sampleDir, "CV-A.txt");
  const cvB = join(sampleDir, "CV-B.pdf");
  for (const name of ["JD.txt", "CV-A.txt", "CV-B.pdf"]) {
    step = `检查示例文件 ${name}`;
    accessSync(join(sampleDir, name), constants.R_OK);
  }

  step = "创建本次输出目录";
  const outputRoot = join(root, "output");
  mkdirSync(outputRoot, { recursive: true });
  const outputDirectory = mkdtempSync(join(outputRoot, "demo-"));

  step = "生成岗位交付物";
  const job = await runLocalJob({ input: jd, out: outputDirectory });
  const [, zip, guide] = job.files;
  step = "生成 CV A（TXT）的专属电话包";
  const a = await runLocalCall({ zip, guide, cv: cvA, out: outputDirectory });
  step = "生成 CV B（PDF）的专属电话包";
  const b = await runLocalCall({ zip, guide, cv: cvB, out: outputDirectory });

  step = "核对两份电话包的岗位版本和编号";
  if ([a, b].some((item) => item.job_id !== job.job_id || item.job_version !== job.job_version)
    || !a.job_package_id || a.job_package_id !== b.job_package_id || a.package_id === b.package_id) {
    throw new Error("demo_handoff_mismatch");
  }

  console.log(JSON.stringify({ output_directory: outputDirectory, job, candidates: { A: a, B: b } }, null, 2));
} catch (error) {
  console.error(`${step}失败。${errorHint(error)}`);
  process.exitCode = 1;
}
