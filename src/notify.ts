import { type JobResult, DEFAULT_NTFY_TOPIC } from "./types.js";
import { formatDuration } from "./utils.js";

export async function sendNtfyNotification(
  results: JobResult[],
  totalDuration: number,
  topic: string = DEFAULT_NTFY_TOPIC
): Promise<boolean> {
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.length - succeeded;

  const durationStr = formatDuration(totalDuration, 0);

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
