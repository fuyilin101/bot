import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Codex, type Usage } from "@openai/codex-sdk";
import { analysisInstructions, analysisSchema, validateAnalysis } from "./analysis.js";

const agentHome = resolve(".tools/recruiting-codex");
const agentWorkspace = resolve(".tools/recruiting-codex-workspace");
const apiKey = process.env.RECRUITING_CODEX_API_KEY?.trim();

function isolatedEnvironment(): Record<string, string> {
  mkdirSync(agentHome, { recursive: true });
  mkdirSync(agentWorkspace, { recursive: true });
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ComSpec",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
  const env: Record<string, string> = { CODEX_HOME: agentHome };
  for (const key of allowed) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export function recruitingCodexLogin(statusOnly = false): boolean {
  if (statusOnly && apiKey) return true;
  const cli = resolve("node_modules/@openai/codex/bin/codex.js");
  const args = [cli, "-c", 'cli_auth_credentials_store="file"', "login"];
  if (statusOnly) args.push("status");
  else if (process.argv.includes("--device-auth")) args.push("--device-auth");
  const result = spawnSync(process.execPath, args, {
    env: isolatedEnvironment(),
    cwd: agentWorkspace,
    stdio: statusOnly ? "ignore" : "inherit",
  });
  return result.status === 0;
}

export function createStructuredRunner(instructions: string, outputSchema: unknown) {
  const codex = new Codex({
    apiKey,
    env: isolatedEnvironment(),
    config: {
      cli_auth_credentials_store: "file",
      developer_instructions: instructions,
      features: {
        shell_tool: false, unified_exec: false, apps: false, plugins: false, memories: false,
        multi_agent: false, multi_agent_v2: false, image_generation: false, request_permissions_tool: false,
      },
      skills: { include_instructions: false, bundled: { enabled: false } },
    },
    configOverrides: ["mcp_servers={}"],
  });
  return async (source: string, signal?: AbortSignal, observeUsage?: (usage: Usage) => void) => {
    const thread = codex.startThread({
      workingDirectory: agentWorkspace,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      threadSource: "feishu-recruiting",
    });
    const timeout = AbortSignal.timeout(120_000);
    const result = await thread.run(source, {
      outputSchema,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (result.usage) observeUsage?.(result.usage);
    if (result.items.some((item) => item.type !== "agent_message" && item.type !== "reasoning")) {
      throw new Error("unexpected_codex_tool_activity");
    }
    return result.finalResponse;
  };
}

export function createJobAnalyzer() {
  const run = createStructuredRunner(analysisInstructions, analysisSchema);
  return async (source: string, signal?: AbortSignal, observeUsage?: (usage: Usage) => void) => {
    const output = await run(JSON.stringify({ feishu_message_text: source }), signal, observeUsage);
    return validateAnalysis(output, source);
  };
}
