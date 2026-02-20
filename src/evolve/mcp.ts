import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import type { EvolveConfig } from "../types.js";

export function createEvolveMcpServer(config: EvolveConfig) {
  return createSdkMcpServer({
    name: "evolve",
    version: "1.0.0",
    tools: [
      tool(
        "check_cycle_budget",
        "Check how many files and lines have been changed so far vs the configured limits. Call this before finishing your changes to ensure you stay within budget.",
        {},
        async () => {
          try {
            const diffStat = execSync("git diff --stat HEAD", {
              cwd: config.project_dir,
              encoding: "utf-8",
            });
            const filesMatch = diffStat.match(/(\d+) files? changed/);
            const insertionsMatch = diffStat.match(/(\d+) insertions?/);
            const deletionsMatch = diffStat.match(/(\d+) deletions?/);

            const filesChanged = filesMatch ? parseInt(filesMatch[1]) : 0;
            const insertions = insertionsMatch ? parseInt(insertionsMatch[1]) : 0;
            const deletions = deletionsMatch ? parseInt(deletionsMatch[1]) : 0;
            const totalLines = insertions + deletions;

            const maxFiles = config.max_files_per_cycle ?? 10;
            const maxLines = config.max_lines_changed_per_cycle ?? 500;

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  files_changed: filesChanged,
                  lines_changed: totalLines,
                  max_files: maxFiles,
                  max_lines: maxLines,
                  files_remaining: maxFiles - filesChanged,
                  lines_remaining: maxLines - totalLines,
                  within_budget: filesChanged <= maxFiles && totalLines <= maxLines,
                }, null, 2),
              }],
            };
          } catch {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ files_changed: 0, lines_changed: 0, within_budget: true }),
              }],
            };
          }
        },
      ),
    ],
  });
}
