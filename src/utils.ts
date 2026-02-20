/**
 * Format a duration in seconds into a human-readable string.
 *
 * @param seconds       - The duration in seconds
 * @param decimalPlaces - Decimal places to show for sub-minute durations (default: 1)
 * @returns A string such as "45.5s", "2m 5s", or "1h 2m"
 */
export function formatDuration(seconds: number, decimalPlaces = 1): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  } else if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    return `${seconds.toFixed(decimalPlaces)}s`;
  }
}
