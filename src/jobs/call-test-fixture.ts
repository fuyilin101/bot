import { validateAnalysis, type Analysis } from "./analysis.js";
import { createJob } from "./artifacts.js";

export const syntheticCallJob = {
  id: "JOB-0000000000000001",
  messageId: "om_r1syntheticseed",
  source: "【完全合成测试】新岗位，招聘企业知识库产品经理，地点北京。硬性要求：必须独立负责需求分析与上线验收。加分条件：有SQL经验优先。",
  title: "企业知识库产品经理",
  hard: "独立负责需求分析与上线验收",
  preferred: "SQL经验",
} as const;

export function createSyntheticCallJob(claim: { messageId: string; sentAt: string } = {
  messageId: syntheticCallJob.messageId, sentAt: "1760000000000",
}) {
  const { source, title, hard, preferred, id } = syntheticCallJob;
  const mock: Analysis = { event: "JOB_CREATE", confidence: 1, job_title: title, company: null, company_industry: null,
    company_business: null, company_size: null, company_website: null, department: null, location: "北京", salary_text: null,
    salary_months_text: null, experience_required: null, education_required: null, responsibilities: [], must_have: [hard],
    nice_to_have: [preferred], technical_keywords: ["SQL"], target_companies: [], job_highlights: [] };
  const job = createJob(validateAnalysis(JSON.stringify(mock), source), claim, id);
  if (job.must_have[0] !== hard || job.nice_to_have[0] !== preferred) throw new Error("unexpected_synthetic_job_levels");
  return job;
}
