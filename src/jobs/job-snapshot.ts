import { analysisSchema, validateAnalysis } from "./analysis.js";
import { createJob, type Job } from "./artifacts.js";

export function jobSnapshot(saved: Job, original: string, source: { messageId: string; sentAt: string }): Job {
  const model = Object.fromEntries(Object.entries(analysisSchema.properties).map(([key, schema]) => {
    const value = (saved as unknown as Record<string, unknown>)[key];
    if (key === "salary_months_text") {
      const months = original.match(/\d{1,2}\s*薪/u)?.[0] ?? null;
      return [key, months && Number.parseInt(months) === saved.salary_months ? months : null];
    }
    return [key, value ?? (schema.type === "array" ? [] : null)];
  }));
  const facts = validateAnalysis(JSON.stringify(model), original);
  const checked = createJob(facts, source, saved.job_id);
  const notes = [...new Map([...(saved.semantic_notes ?? []), ...(checked.semantic_notes ?? [])].map((note) => [JSON.stringify(note), note])).values()];
  return { ...checked, semantic_notes: notes,
    missing_information: [...new Set([...saved.missing_information, ...checked.missing_information])],
    version: saved.version, created_at: saved.created_at, updated_at: saved.updated_at,
    source_message_ids: saved.source_message_ids, source_references: saved.source_references };
}
