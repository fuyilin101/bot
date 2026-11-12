import type { Analysis } from "./analysis.js";

type SourcingInput = Pick<Analysis, "job_title" | "location" | "responsibilities" | "must_have" | "nice_to_have" | "technical_keywords">;

const aiProductTitles = ["AI 产品经理", "人工智能产品经理", "AI Product Manager"];
const llmProductTitles = ["大模型产品经理", "LLM 产品经理", "大模型应用产品经理", "LLM Product Manager"];
const titleGroups = [
  aiProductTitles,
  llmProductTitles,
  ["产品经理", "Product Manager"],
  ["后端开发工程师", "后端工程师", "Backend Engineer", "Backend Developer"],
  ["前端开发工程师", "前端工程师", "Frontend Engineer", "Frontend Developer"],
  ["算法工程师", "Algorithm Engineer"],
  ["数据分析师", "Data Analyst"],
  ["测试工程师", "软件测试工程师", "QA Engineer"],
  ["解决方案工程师", "Solutions Engineer"],
];

const cityGroups = [
  ["北京", "Beijing"], ["上海", "Shanghai"], ["深圳", "Shenzhen"], ["杭州", "Hangzhou"],
  ["广州", "Guangzhou"], ["成都", "Chengdu"], ["南京", "Nanjing"], ["苏州", "Suzhou"],
  ["武汉", "Wuhan"], ["西安", "Xi'an"], ["重庆", "Chongqing"], ["天津", "Tianjin"],
];

function cleanTerm(value: string): string {
  return value.normalize("NFKC").replace(/["“”`]/g, " ").replace(/\s+/g, " ").trim();
}

function termKey(value: string): string {
  return value.toLowerCase().replace(/\s/g, "");
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map(cleanTerm).filter((value) => {
    const key = termKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryGroup(values: string[]): string {
  const phrases = values.map((value) => `"${value}"`);
  return phrases.length > 1 ? `(${phrases.join(" OR ")})` : phrases[0] ?? "";
}

export function buildSourcingPlan(job: SourcingInput) {
  const title = cleanTerm(job.job_title ?? "");
  const titleKey = termKey(title);
  const aliases = titleGroups.find((group) => group.some((value) => termKey(value) === titleKey));
  const modelContext = [...job.responsibilities, ...job.must_have, ...job.nice_to_have, ...job.technical_keywords].join(" ");
  const llmAliases = aliases === aiProductTitles && /大模型|\bLLMs?\b/i.test(modelContext) ? llmProductTitles : [];
  const titles = uniqueTerms([title, ...llmAliases, ...(aliases ?? [])]);
  const chineseTitles = titles.filter((value) => /\p{Script=Han}/u.test(value));

  const place = cleanTerm(job.location ?? "");
  const narrowByPlace = Boolean(place) && !/待确认|未定|不限|全国|远程|\bremote\b|\banywhere\b/i.test(place);
  const locations = narrowByPlace
    ? uniqueTerms(place.split(/\s+or\s+|[,、/;]|或者?/i).flatMap((term) => {
      const key = termKey(term).replace(/市$/, "");
      return cityGroups.find((group) => group.some((value) => termKey(value) === key)) ?? [term];
    }))
    : [];

  return {
    bossKeywords: chineseTitles.length ? chineseTitles : titles,
    locationFilter: narrowByPlace ? place : null,
    profileQuery: titles.length ? ["site:linkedin.com/in", queryGroup(titles), queryGroup(locations)].filter(Boolean).join(" ") : null,
    skillTerms: uniqueTerms(job.technical_keywords),
  };
}
