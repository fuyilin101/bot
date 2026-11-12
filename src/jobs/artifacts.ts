import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { ValidatedAnalysis } from "./analysis.js";
import { buildSourcingPlan } from "./sourcing-plan.js";
import { createJobManifest, guideHeader, manifestName, sha256 } from "./job-package-format.js";

export const artifactNames = ["01_search_strategy.md", "02_source_package.zip", "03_call_guide.md"] as const;
const artifactFormat = 4;

export function createJob(analysis: ValidatedAnalysis, source: { messageId: string; sentAt: string }, jobId: string) {
  const { event, salary_text, salary_months_text, ...facts } = analysis;
  const range = salary_text?.match(/(\d+(?:\.\d+)?)\s*(k|千|万|元)?\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)\s*(k|千|万|元)/i);
  const scales: Record<string, number> = { k: 1_000, 千: 1_000, 万: 10_000, 元: 1 };
  const maxUnit = range?.[4]?.toLowerCase();
  const max = range && maxUnit ? Number(range[3]) * scales[maxUnit] : null;
  const min = range && maxUnit ? Number(range[1]) * scales[range[2]?.toLowerCase() ?? maxUnit] : null;
  const ordered = min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min <= max;
  const missing = [
    ["公司", facts.company], ["招聘方行业", facts.company_industry], ["部门", facts.department], ["工作地点", facts.location], ["薪资范围", salary_text],
    ["薪资周期或币种", salary_text && /(?:每月|月薪|年薪|\/月|\/年)/.test(salary_text) && /(?:人民币|元|CNY|RMB)/i.test(salary_text)],
    ["薪资月数", salary_months_text], ["经验要求", facts.experience_required], ["学历要求", facts.education_required],
    ["职责", facts.responsibilities.length],
  ].filter(([, value]) => !value).map(([label]) => String(label));
  for (const note of facts.semantic_notes ?? []) {
    if (note.outcome === "conflict" || note.outcome === "unclear" || note.outcome === "unverified") {
      const field = note.field === "requirements" ? "要求等级" : "招聘方行业";
      const reason = note.outcome === "conflict" ? "原文表述冲突" : "原文依据不足";
      missing.push(`${field}待确认（${reason}）${note.evidence.join("；")}`);
    }
  }
  const now = new Date().toISOString();
  return {
    ...facts,
    job_id: jobId,
    salary_text,
    salary_min: ordered ? min : null,
    salary_max: ordered ? max : null,
    salary_months: Number(salary_months_text?.match(/(\d{1,2})\s*薪/)?.[1]) || null,
    missing_information: [...new Set(missing)],
    source_message_ids: [source.messageId],
    source_references: [{ message_id: source.messageId, sent_at: source.sentAt }],
    artifact_format: artifactFormat,
    event,
    version: 1,
    status: missing.length ? "draft_needs_confirmation" : "draft",
    created_at: now,
    updated_at: now,
  };
}

type NewJob = ReturnType<typeof createJob>;
export type Job = Omit<NewJob, "artifact_format" | "company_industry" | "company_business" | "company_size" | "company_website">
  & Partial<Pick<NewJob, "artifact_format" | "company_industry" | "company_business" | "company_size" | "company_website">>
  & { sourcing_strategy_format?: number };

function markdown(value: string | null): string {
  return value?.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#|]/g, "\\$&") || "待确认";
}

function list(values: string[]): string {
  return values.length ? values.map((value) => `- ${markdown(value)}`).join("\n") : "- 待确认";
}

function sourcingQueries(job: Job): string {
  if (job.artifact_format === artifactFormat || job.artifact_format === 3 || job.sourcing_strategy_format === 2) {
    const plan = buildSourcingPlan(job);
    const profileQuery = plan.profileQuery ? ["```text", plan.profileQuery, "```"].join("\n") : "待确认岗位名称。";
    return [
      "",
      "### BOSS 直聘",
      `- 分别搜索 ${plan.bossKeywords.map(markdown).join("、") || "待确认"}`,
      `- 地点筛选 ${plan.locationFilter ? markdown(plan.locationFilter) : "暂不限定，结合岗位原文核实"}`,
      `- 经验核查 ${markdown(job.experience_required)}。以候选人的实际经历核实。`,
      "",
      "### 公开网页搜索（LinkedIn 个人资料页）",
      "",
      profileQuery,
      "",
      `岗位提到的技术词 ${plan.skillTerms.map(markdown).join("、") || "待确认"}。可用于二次检索，硬性条件和加分条件按上文分别核实。`,
      "",
      ...(job.artifact_format === artifactFormat || job.artifact_format === 3 ? [
        "### 给寻访助手的提示词", "",
        "根据上面的岗位事实和渠道查询，从公开职业资料中寻找候选线索。按以下规则检索和核验。", "",
        "1. 先用职称和同义职称召回，再按已确认的地区缩小范围。把现任、过往职称分开记录。",
        "2. 用核心技能、项目任务和交付结果做第二轮检索。找出候选人亲自负责的工作、实际产出及项目时间；用工作时间线核实相关经验年限。",
        "3. 招聘方提供的目标企业、相近业务和行业用于拓宽线索；按 JD 明确的限制执行。加分条件用于排序，硬性条件逐项核实。",
        "4. 按职业资料链接去重。每条线索给出来源 URL、证据摘录、命中的条件和待核实项。资料缺失时标为待核实，明确冲突时给出证据。", "",
        "### 方法参考", "",
        "- 将职称、技能、公司和地区拆为检索字段，结合自由文本找项目证据。[Talent Search and Recommendation Systems at LinkedIn](https://arxiv.org/abs/1809.06481)",
        "- 用代表性技能和相近公司扩展搜索范围。[Search by Ideal Candidates](https://arxiv.org/abs/1602.08186)",
        "- 公开资料中的技能列表可能不完整，因此保留待核实状态。[Personalized Expertise Search at LinkedIn](https://arxiv.org/abs/1602.04572)", "",
      ] : []),
    ].join("\n");
  }

  const keywords = [...new Set([job.job_title, ...job.technical_keywords].filter((item): item is string => Boolean(item)))];
  const boolean = keywords.slice(0, 6).map((word) => `"${word.replace(/["\r\n]/g, " ").trim()}"`).join(" OR ");
  return `- 关键词 ${keywords.map(markdown).join("、") || "待确认"}。同义词需结合检索结果确认。\n- Boolean Search 草案 ${markdown(boolean || null)}\n- 渠道可先用公开招聘平台和专业社区。`;
}

export function writeArtifacts(job: Job, root: string, sourceText?: string): void {
  const portable = job.artifact_format === artifactFormat;
  const expanded = portable || job.artifact_format === 3;
  if (expanded && sourceText === undefined) throw new Error("missing_original_message");
  const folder = join(root, job.job_id, `v${job.version}`);
  mkdirSync(folder, { recursive: true });
  const header = `岗位 ${job.job_id} · v${job.version}\n\n生成时间 ${job.created_at}\n`;
  const basics = `- 岗位 ${markdown(job.job_title)}\n- 公司 ${markdown(job.company)}\n- 部门 ${markdown(job.department)}\n- 地点 ${markdown(job.location)}\n- 薪资原文 ${markdown(job.salary_text)}\n- 经验 ${markdown(job.experience_required)}\n- 学历 ${markdown(job.education_required)}`;
  const gaps = list(job.missing_information);
  const search = `# 主动寻访策略\n\n${header}\n## 来源消息中的岗位事实\n\n${basics}\n\n### 必须满足\n\n${list(job.must_have)}\n\n### 加分条件\n\n${list(job.nice_to_have)}\n\n### 来源方提供的目标企业\n\n${list(job.target_companies)}\n\n## 寻访建议（待验证）\n\n- 画像以岗位及明确的硬性条件为准，优先核实类似项目中的个人职责。\n- 企业来源可先搜索公开招聘中有类似岗位的团队，再核对团队业务。\n${sourcingQueries(job)}\n- 排除依据只使用已明确的硬性条件。\n\n## 待确认与风险\n\n${gaps}\n`;
  const call = `# 电话沟通指南\n\n${header}\n## 来源消息中的岗位事实\n\n${basics}\n\n### 职位亮点\n\n${list(job.job_highlights)}\n\n## 沟通建议\n\n- 开场：您好，我想和您沟通一个${markdown(job.job_title)}机会，方便先聊两分钟吗？\n- 经验：能介绍一个与该岗位最接近的项目，以及您负责的部分和结果吗？\n- 技术：当时的方案、关键取舍和验证指标是什么？\n- 意向：您目前考虑机会时，最关注哪些条件？工作地点和到岗时间有什么偏好？\n- 异议：对薪资或职责有疑问时，复述已确认信息，并约定核实后的反馈时间。\n\n## 向 PM 核实\n\n${gaps}\n`;
  const summary = `# 岗位摘要\n\n${header}\n${basics}\n\n## 工作职责\n\n${list(job.responsibilities)}\n\n## 待确认\n\n${gaps}\n`;
  const { sourcing_strategy_format, artifact_format, ...jd } = job;
  const company = [
    "# 公司信息", "", header,
    "## 原始需求提供的信息", "",
    `- 招聘公司 ${markdown(job.company)}`,
    `- 行业 ${markdown(job.company_industry ?? null)}`,
    `- 主营业务或产品 ${markdown(job.company_business ?? null)}`,
    `- 公司规模 ${markdown(job.company_size ?? null)}`,
    `- 官网 ${markdown(job.company_website ?? null)}`,
    "", "待确认项由招聘方补充。来源索引见 sources.json。",
  ].join("\n");
  const entries: Record<string, Uint8Array> = {
    "jd.json": strToU8(JSON.stringify(jd, null, 2)),
    "summary.md": strToU8(expanded
      ? `${summary}\n## 必须满足\n\n${list(job.must_have)}\n\n## 加分条件\n\n${list(job.nice_to_have)}\n\n## 职位亮点\n\n${list(job.job_highlights)}\n`
      : summary),
    "sources.json": strToU8(JSON.stringify({
      job_id: job.job_id, version: job.version, generated_at: job.created_at, sources: job.source_references,
    }, null, 2)),
    ...(expanded && sourceText !== undefined ? {
      "original_message.txt": strToU8(sourceText),
      "company.md": strToU8(company),
    } : {}),
  };
  const identity = { job_id: job.job_id, job_version: job.version, generated_at: job.created_at };
  if (portable) entries[manifestName] = strToU8(JSON.stringify(createJobManifest(identity, entries, call), null, 2));
  // The manifest records the real time. A fixed DOS timestamp keeps the ZIP hash reproducible across hosts.
  const zip = zipSync(entries, portable ? { mtime: new Date(2000, 0, 1) } : {});
  writeFileSync(join(folder, artifactNames[0]), search, "utf8");
  writeFileSync(join(folder, artifactNames[1]), zip);
  writeFileSync(join(folder, artifactNames[2]), portable ? guideHeader(identity, sha256(zip)) + call : call, "utf8");
}
