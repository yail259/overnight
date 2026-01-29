import { type JobResult, DEFAULT_NTFY_TOPIC } from "./types.js";

export async function sendNtfyNotification(
  results: JobResult[],
  totalDuration: number,
  topic: string = DEFAULT_NTFY_TOPIC
): Promise<boolean> {
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.length - succeeded;

  // Format duration
  let durationStr: string;
  if (totalDuration >= 3600) {
    const hours = Math.floor(totalDuration / 3600);
    const mins = Math.floor((totalDuration % 3600) / 60);
    durationStr = `${hours}h ${mins}m`;
  } else if (totalDuration >= 60) {
    const mins = Math.floor(totalDuration / 60);
    const secs = Math.floor(totalDuration % 60);
    durationStr = `${mins}m ${secs}s`;
  } else {
    durationStr = `${totalDuration.toFixed(0)}s`;
  }

  const title =
    failed === 0
      ? `overnight: ${succeeded}/${results.length} succeeded`
      : `overnight: ${failed} failed`;

  const message = `Completed in ${durationStr}\n${succeeded} succeeded, ${failed} failed`;

  const priority = failed === 0 ? "default" : "high";
  const tags = failed === 0 ? "white_check_mark" : "warning";

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: priority,
        Tags: tags,
      },
      body: message,
    });

    return response.ok;
  } catch {
    return false;
  }
}
