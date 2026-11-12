import type { Analysis } from "./analysis.js";

type RequirementLevel = "hard" | "preferred" | "not_required" | "unclear";
type RequirementOutcome = RequirementLevel | "conflict";
export type SemanticNote =
  | { field: "requirements"; term: string; outcome: RequirementOutcome; evidence: string[] }
  | { field: "company_industry"; outcome: "corrected" | "unverified" | "conflict"; evidence: string[] };

const clauseBreak = /[\r\n。；;，,！？!?]+|(?:并且|且|但是|但|不过|、)(?=\s*(?:(?:必须|最好|希望|不要求|不强制|至少|优先(?:考虑|有|具备))[^，。；\r\n]{2}|[^，。；\r\n]{2,24}(?:优先|也可)))/u;
const mandatory = /(?:必须|硬性要求|硬性条件|必备|至少|最低|不低于|不得少于|(?:需要|需|须|要求)(?:有|具备|达到|满足))|^要求\s*[:：]/u;
const preference = /最好|优先|希望|加分|更佳|尤佳|首选/u;
const optional = /不要求|不强制|不(?:作|做)(?:为)?(?:硬性)?要求|(?:不是|并非|非)硬性(?:要求|条件)?|不(?:是|一定|再)必须|并非必须|不一定需要|不必|不需要|无需|无须/u;
const alternative = /也可|亦可|均可|不限|放宽|例外|或者?|接受.{0,12}替代/u;
const uncertain = /待确认|待定|不确定|尚未确定|暂未确定|是否.{0,8}(?:必须|硬性|需要|要求)|不优先/u;
const uncertaintySuffix = /^(?:(?:具体|最终|仍|还|暂)?待(?:确认|定)|尚未确定|不确定)$/u;
const suggested = /(?:AI|模型|寻访|搜索)(?:建议|推测|方向)|(?:外部研究|公开资料)(?:推测|显示|建议)/iu;
const education = /学历|博士|硕士|研究生|本科|大专|专科|高中/u;
const years = /经验年限|工作年限|\d+\s*年/u;
const implicitMinimum = /^(?:[\d０-９]+\s*年(?:\s*(?:及)?以上|\s*[+＋])[^\s。]*经验|(?:博士|硕士|研究生|本科|大专|专科)(?:及)?以上(?:学历)?)$/u;
const outcomeOrder: RequirementLevel[] = ["unclear", "hard", "preferred", "not_required"];

function clausesOf(source: string): string[] {
  return source.split(clauseBreak).map((clause) => clause.trim()).filter(Boolean);
}

function conditionKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s/g, "")
    .replace(/^(?:[-*•]|候选人|应聘者|要求:|并非必须|不是必须|不一定需要|不要求|不强制|不需要|不必|无需|无须|必须|最好|希望|优先(?:考虑)?|加分项:|不低于|不得少于|至少|最低|要求|需要|需|须|具备|有)+/u, "")
    .replace(/(?:优先(?:考虑)?|更佳|尤佳|加分(?:项)?|也可|亦可|均可)$/u, "");
}

function mentionsCondition(clause: string, key: string): boolean {
  const normalized = conditionKey(clause);
  if (!key) return false;
  if (!/^\d/u.test(key)) return normalized.includes(key);
  // A clipped “3年…” should not match “13年…”.
  for (let start = normalized.indexOf(key); start !== -1; start = normalized.indexOf(key, start + 1)) {
    if (start === 0 || !/[\d.]/u.test(normalized[start - 1])) return true;
  }
  return false;
}

function isAdjacentAlternative(clause: string, next: string): boolean {
  if (!alternative.test(next)) return false;
  return /^(?:也可|亦可|均可|可放宽|(?:可以?)?例外)(?:考虑|接受)?$/u.test(next)
    || (education.test(clause) && education.test(next))
    || (years.test(clause) && years.test(next));
}

function classifyClause(clause: string): RequirementLevel {
  if (alternative.test(clause) || uncertain.test(clause) || suggested.test(clause)) return "unclear";
  const notRequired = optional.test(clause);
  const hard = mandatory.test(clause.replace(optional, "")) || implicitMinimum.test(clause.replace(/\s/g, ""));
  const preferred = preference.test(clause);
  if (hard && (notRequired || preferred)) return "unclear";
  if (preferred) return "preferred";
  if (notRequired) return "not_required";
  return hard ? "hard" : "unclear";
}

function resolveRequirement(value: string, clauses: string[]): { outcome: RequirementOutcome; evidence: string[] } {
  const key = conditionKey(value);
  const evidence = new Set<string>();
  const levels = new Set<RequirementLevel>();
  for (const [index, clause] of clauses.entries()) {
    if (!mentionsCondition(clause, key)) continue;
    const next = clauses[index + 1] ?? "";
    const level = classifyClause(clause);
    evidence.add(clause);
    if (uncertaintySuffix.test(next) || (level === "hard" && isAdjacentAlternative(clause, next))) {
      levels.add("unclear");
      evidence.add(next);
    } else {
      levels.add(level);
    }
  }
  if (levels.has("hard") && (levels.has("not_required") || levels.has("preferred"))) {
    return { outcome: "conflict", evidence: [...evidence] };
  }
  const outcome = outcomeOrder.find((level) => levels.has(level)) ?? "unclear";
  return { outcome, evidence: evidence.size ? [...evidence] : [value] };
}

const employer = "(?:招聘方|招聘公司|用人单位|雇主|本公司|本企业|我司|我们公司|我们)";
const industryLabel = new RegExp(`^(?:${employer}|公司)(?:的)?(?:所属)?行业\\s*(?:[:：]|是|为)\\s*(.+)$`, "u");
const industryIdentity = new RegExp(`^${employer}\\s*(?:是|为|系|属于)\\s*(?:一家|一间)?\\s*(.+?)(企业|公司|机构|行业|领域)$`, "u");
// Short “某某公司” identities are accepted only for recognizable industry descriptors.
const companyType = /^(?:软件(?:开发)?|互联网|人工智能|信息技术|医疗器械|医疗服务|生物医药|医药|制药|半导体|电子制造|汽车制造|汽车|金融|银行|保险|证券|零售|电商|电子商务|物流|餐饮|教育|房地产|建筑|化工|能源|新能源|游戏|广告|咨询)$/u;
const unverifiedIndustry = /^(?:非|不|可能)|待确认|不详|未知|可能|待定|或者?|经验|候选人|客户|服务|优先|面向|相关|不限/u;

function employerIndustry(clause: string, company: string | null): string | undefined {
  if (suggested.test(clause)) return;
  const text = clause.replace(/^(?:【[^】]*】\s*|[-*•]\s*)+/u, "");
  const label = industryLabel.exec(text)?.[1]?.trim();
  if (label && !unverifiedIndustry.test(label)) return label;

  const identity = industryIdentity.exec(text);
  if (identity) {
    const [, subject, suffix] = identity;
    const industry = subject.trim();
    if (industry && !unverifiedIndustry.test(industry)
      && (suffix === "行业" || suffix === "领域" || companyType.test(industry))) return industry;
  }

  if (!company || !text.startsWith(company)) return;
  const descriptor = /^\s*[（(]\s*([^（(）)]+?行业)(?:\s*[）)]|\s*$)/u.exec(text.slice(company.length))?.[1];
  if (descriptor && !unverifiedIndustry.test(descriptor)) return descriptor;
}

function industryKey(industry: string): string {
  return industry.normalize("NFKC").toLowerCase().replace(/\s/g, "").replace(/(?:行业|领域)$/u, "");
}

function validateIndustry(value: Analysis, clauses: string[], notes: SemanticNote[]): string | null {
  const evidence = clauses.flatMap((clause, index) => {
    const industry = employerIndustry(clause, value.company);
    const next = clauses[index + 1] ?? "";
    const excerpts = uncertaintySuffix.test(next) ? [clause, next] : [clause];
    return industry ? [{ excerpts, industry }] : [];
  });
  const distinct = new Set(evidence.map(({ industry }) => industryKey(industry)));
  const employerEvidence = evidence.flatMap(({ excerpts }) => excerpts);
  if (distinct.size > 1) {
    notes.push({ field: "company_industry", outcome: "conflict", evidence: employerEvidence });
    return null;
  }
  const proposed = value.company_industry;
  const confirmed = evidence.some(({ excerpts }) => excerpts.length > 1) ? null : evidence[0]?.industry ?? null;
  if (proposed && confirmed && industryKey(proposed) === industryKey(confirmed)) return proposed;
  if (proposed || employerEvidence.length) {
    const proposedEvidence = proposed ? clauses.filter((clause) => clause.includes(proposed)) : [];
    notes.push({ field: "company_industry", outcome: confirmed ? "corrected" : "unverified",
      evidence: [...new Set([...employerEvidence, ...proposedEvidence])] });
  }
  return confirmed;
}

export function validateSemantics(value: Analysis, source: string): SemanticNote[] {
  const clauses = clausesOf(source);
  const notes: SemanticNote[] = [];
  const hard = new Set(value.must_have.flatMap(clausesOf));
  const preferred = new Set(value.nice_to_have.flatMap(clausesOf));
  const scalarRequirements = ["experience_required", "education_required"] as const;
  const terms = new Set([...hard, ...preferred, ...scalarRequirements.flatMap((field) => value[field] ?? [])]);
  const resolutions = new Map([...terms].map((term) => [term, resolveRequirement(term, clauses)]));
  value.must_have = [];
  value.nice_to_have = [];
  for (const [term, { outcome, evidence }] of resolutions) {
    if (outcome === "hard" && (hard.has(term) || preferred.has(term))) value.must_have.push(term);
    if (outcome === "preferred") value.nice_to_have.push(term);
    if ((outcome === "hard" && !preferred.has(term)) || (outcome === "preferred" && !hard.has(term)
      && !scalarRequirements.some((field) => value[field] === term))) continue;
    notes.push({ field: "requirements", term, outcome, evidence });
  }
  for (const field of scalarRequirements) {
    const term = value[field];
    if (term && resolutions.get(term)?.outcome !== "hard") value[field] = null;
  }
  value.company_industry = validateIndustry(value, clauses, notes);
  return notes;
}
