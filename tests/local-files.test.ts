import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { validateAnalysis, type Analysis } from "../src/jobs/analysis.js";
import { artifactNames, type Job } from "../src/jobs/artifacts.js";
import type { CallPackage, CallRequirement } from "../src/jobs/call-package.js";
import { syntheticCallJob } from "../src/jobs/call-test-fixture.js";
import type { CvLine } from "../src/jobs/cv-input.js";
import { runLocalCall, runLocalJob } from "../src/jobs/local-files.js";

test("local job artifacts hand off a verified job and version to a local call package", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "recruiting-local-files-"));
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.match(basename(target), /^recruiting-local-files-/);
    rmSync(target, { recursive: true });
  });
  const { source, title, hard, preferred } = syntheticCallJob;
  const input = join(root, "job.txt");
  const cv = join(root, "cv.txt");
  const experience = "工作经历：参与知识库项目，协助整理访谈纪要、需求清单和上线记录，配合产品负责人核对验收事项。";
  writeFileSync(input, source, "utf8");
  writeFileSync(cv, `${experience}\n项目经历：整理用户反馈、协调研发与测试进度，个人决策范围和验收职责需要核实。`, "utf8");
  const draft: Analysis = {
    event: "JOB_CREATE", confidence: 1, job_title: title, company: null, company_industry: null, company_business: null,
    company_size: null, company_website: null, department: null, location: "北京", salary_text: null,
    salary_months_text: null, experience_required: null, education_required: null, responsibilities: [], must_have: [hard],
    nice_to_have: [preferred], technical_keywords: ["SQL"], target_companies: [], job_highlights: [],
  };
  const job = await runLocalJob({ input, out: join(root, "jobs") }, async (text) => {
    assert.equal(text, source);
    return validateAnalysis(JSON.stringify(draft), text);
  });
  assert.match(job.job_id, /^JOB-[A-F0-9]{16}$/u);
  assert.equal(job.job_version, 1);
  assert.deepEqual(readdirSync(job.output_directory).sort(), [...artifactNames].sort());
  assert.deepEqual(job.files.map((file) => basename(file)), [...artifactNames]);
  const [, zip, guide] = job.files;

  let calls = 0;
  const analyze = async (prompt: string) => {
    calls++;
    const data = JSON.parse(prompt) as { job: Job; general_guide: string; requirements: CallRequirement[]; untrusted_cv_lines: CvLine[] };
    assert.equal(data.job.job_id, job.job_id);
    assert.equal(data.job.version, job.job_version);
    assert.match(data.general_guide, /^# 电话沟通指南/u);
    const line = data.untrusted_cv_lines[0];
    assert.equal(line.text, experience);
    const evidence = { line: line.line, quote: line.text };
    return JSON.stringify({ work_evidence: [evidence], comparisons: data.requirements.map(({ index, level }) => ({
      index, level, status: level === "hard" ? "clarify" : "not_mentioned", evidence: level === "hard" ? evidence : null,
    })), priority_indices: [0], risks: [] });
  };

  const call = await runLocalCall({ zip, guide, cv, out: join(root, "calls") }, analyze);
  assert.equal(calls, 1);
  assert.deepEqual(readdirSync(call.output_directory).sort(), [`${call.package_id}.json`, `${call.package_id}.md`]);
  const pack = JSON.parse(readFileSync(call.files[0], "utf8")) as CallPackage;
  assert.equal(pack.job_id, job.job_id);
  assert.equal(pack.job_version, job.job_version);
  assert.equal(pack.job_package_id, call.job_package_id);
  assert.equal(pack.candidate_summary[0].text, experience);
  assert.match(readFileSync(call.files[1], "utf8"), /候选人专属电话包/u);

  const tamperedGuide = join(root, "tampered-guide.md");
  const rejectedOut = join(root, "rejected");
  writeFileSync(tamperedGuide, `${readFileSync(guide, "utf8")}\n额外内容`, "utf8");
  await assert.rejects(runLocalCall({ zip, guide: tamperedGuide, cv, out: rejectedOut }, analyze), { code: "job_import_guide_hash_mismatch" });
  assert.equal(calls, 1);
  assert.equal(existsSync(rejectedOut), false);
});
