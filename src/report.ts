import { writeFileSync } from "fs";
import { type JobResult } from "./types.js";
import { formatDuration } from "./utils.js";

export function generateReport(
  results: JobResult[],
  totalDuration: number,
  outputPath?: string
): string {
  const lines: string[] = [];

  // Header
  lines.push("# Overnight Run Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString().replace("T", " ").split(".")[0]}`);
  lines.push("");

  // Summary
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.length - succeeded;

  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Jobs:** ${succeeded}/${results.length} succeeded`);
  if (failed > 0) {
    lines.push(`- **Failed:** ${failed}`);
  }

  lines.push(`- **Total duration:** ${formatDuration(totalDuration)}`);
  lines.push("");

  // Job details table
  lines.push("## Job Results");
  lines.push("");
  lines.push("| # | Status | Duration | Task |");
  lines.push("|---|--------|----------|------|");

  const statusEmoji: Record<string, string> = {
    success: "✅",
    failed: "❌",
    timeout: "⏱️",
    stalled: "🔄",
    verification_failed: "⚠️",
  };

  results.forEach((r, i) => {
    let taskPreview = r.task.slice(0, 50).replace(/\n/g, " ").trim();
    if (r.task.length > 50) taskPreview += "...";
    const emoji = statusEmoji[r.status] ?? "❓";
    lines.push(
      `| ${i + 1} | ${emoji} ${r.status} | ${r.duration_seconds.toFixed(1)}s | ${taskPreview} |`
    );
  });

  lines.push("");

  // Failed jobs details
  const failures = results.filter((r) => r.status !== "success");
  if (failures.length > 0) {
    lines.push("## Failed Jobs");
    lines.push("");

    failures.forEach((r, i) => {
      const taskPreview = r.task.slice(0, 80).replace(/\n/g, " ").trim();
      lines.push(`### ${i + 1}. ${taskPreview}`);
      lines.push("");
      lines.push(`- **Status:** ${r.status}`);
      if (r.error) {
        lines.push(`- **Error:** ${r.error.slice(0, 200)}`);
      }
      if (r.retries > 0) {
        lines.push(`- **Retries:** ${r.retries}`);
      }
      lines.push("");
    });
  }

  // Next steps
  lines.push("## Next Steps");
  lines.push("");
  if (failed === 0) {
    lines.push("All jobs completed successfully! No action needed.");
  } else {
    lines.push("The following jobs need attention:");
    lines.push("");
    results.forEach((r, i) => {
      if (r.status !== "success") {
        const taskPreview = r.task.slice(0, 60).replace(/\n/g, " ").trim();
        lines.push(`- [ ] Job ${i + 1}: ${taskPreview} (${r.status})`);
      }
    });
  }
  lines.push("");

  const content = lines.join("\n");

  if (outputPath) {
    writeFileSync(outputPath, content);
  }

  return content;
}
