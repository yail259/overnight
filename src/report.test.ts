import { expect, test, describe } from "bun:test";
import { generateReport } from "./report.js";
import type { JobResult } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<JobResult> = {}): JobResult {
  return {
    task: "Do something useful",
    status: "success",
    duration_seconds: 10,
    verified: false,
    retries: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------

describe("generateReport – structure", () => {
  test("returns a non-empty string", () => {
    const report = generateReport([], 0);
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });

  test("includes the markdown header", () => {
    expect(generateReport([], 0)).toContain("# Overnight Run Report");
  });

  test("includes a Summary section", () => {
    expect(generateReport([], 0)).toContain("## Summary");
  });

  test("includes a Job Results section", () => {
    expect(generateReport([makeResult()], 5)).toContain("## Job Results");
  });

  test("includes a Next Steps section", () => {
    expect(generateReport([], 0)).toContain("## Next Steps");
  });
});

// ---------------------------------------------------------------------------
// Job counts
// ---------------------------------------------------------------------------

describe("generateReport – job counts", () => {
  test("shows 0/0 when there are no jobs", () => {
    expect(generateReport([], 0)).toContain("0/0 succeeded");
  });

  test("shows correct counts for all-success run", () => {
    const results = [makeResult(), makeResult(), makeResult()];
    expect(generateReport(results, 60)).toContain("3/3 succeeded");
  });

  test("shows correct counts for mixed run", () => {
    const results = [
      makeResult({ status: "success" }),
      makeResult({ status: "failed" }),
      makeResult({ status: "timeout" }),
    ];
    const report = generateReport(results, 60);
    expect(report).toContain("1/3 succeeded");
    expect(report).toContain("**Failed:** 2");
  });

  test("does not show Failed line when there are no failures", () => {
    const results = [makeResult()];
    expect(generateReport(results, 10)).not.toContain("**Failed:**");
  });
});

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

describe("generateReport – duration formatting", () => {
  test("formats sub-minute durations in seconds", () => {
    expect(generateReport([makeResult()], 45.5)).toContain("45.5s");
  });

  test("formats 60 s as 1m 0s", () => {
    expect(generateReport([makeResult()], 60)).toContain("1m 0s");
  });

  test("formats durations in minutes and seconds", () => {
    expect(generateReport([makeResult()], 125)).toContain("2m 5s");
  });

  test("formats exactly 1 hour", () => {
    expect(generateReport([makeResult()], 3600)).toContain("1h 0m");
  });

  test("formats hours and minutes", () => {
    expect(generateReport([makeResult()], 3750)).toContain("1h 2m");
  });

  test("formats multi-hour durations", () => {
    expect(generateReport([makeResult()], 7384)).toContain("2h 3m");
  });
});

// ---------------------------------------------------------------------------
// Status emojis
// ---------------------------------------------------------------------------

describe("generateReport – status emojis", () => {
  test("✅ for success", () => {
    expect(generateReport([makeResult({ status: "success" })], 10)).toContain("✅");
  });

  test("❌ for failed", () => {
    expect(generateReport([makeResult({ status: "failed" })], 10)).toContain("❌");
  });

  test("⏱️ for timeout", () => {
    expect(generateReport([makeResult({ status: "timeout" })], 10)).toContain("⏱️");
  });

  test("🔄 for stalled", () => {
    expect(generateReport([makeResult({ status: "stalled" })], 10)).toContain("🔄");
  });

  test("⚠️ for verification_failed", () => {
    expect(
      generateReport([makeResult({ status: "verification_failed" })], 10)
    ).toContain("⚠️");
  });
});

// ---------------------------------------------------------------------------
// Task name truncation
// ---------------------------------------------------------------------------

describe("generateReport – task truncation", () => {
  test("short task names are not truncated", () => {
    const task = "Short task";
    const report = generateReport([makeResult({ task })], 10);
    expect(report).toContain(task);
    expect(report).not.toContain("...");
  });

  test("task names longer than 50 chars are truncated in the table", () => {
    const longTask = "A".repeat(60);
    const report = generateReport([makeResult({ task: longTask })], 10);
    expect(report).toContain("...");
  });

  test("task names of exactly 50 chars are not truncated", () => {
    const task = "B".repeat(50);
    const report = generateReport([makeResult({ task })], 10);
    // Should appear verbatim without ellipsis in table row
    expect(report).toContain(task);
  });

  test("newlines in task names are replaced with spaces in table", () => {
    const task = "Line one\nLine two";
    const report = generateReport([makeResult({ task })], 10);
    // The newline should be replaced with a space in the table cell
    expect(report).toContain("Line one Line two");
  });
});

// ---------------------------------------------------------------------------
// Failed jobs section
// ---------------------------------------------------------------------------

describe("generateReport – failed jobs section", () => {
  test("no Failed Jobs section when all jobs succeed", () => {
    const report = generateReport([makeResult()], 10);
    expect(report).not.toContain("## Failed Jobs");
  });

  test("includes Failed Jobs section when there are failures", () => {
    const report = generateReport([makeResult({ status: "failed" })], 10);
    expect(report).toContain("## Failed Jobs");
  });

  test("includes error message in Failed Jobs section", () => {
    const report = generateReport(
      [makeResult({ status: "failed", error: "Segfault at dawn" })],
      10
    );
    expect(report).toContain("Segfault at dawn");
  });

  test("shows retry count when retries > 0", () => {
    const report = generateReport(
      [makeResult({ status: "failed", retries: 3 })],
      10
    );
    expect(report).toContain("**Retries:** 3");
  });

  test("does not show retry count when retries = 0", () => {
    const report = generateReport(
      [makeResult({ status: "failed", retries: 0 })],
      10
    );
    expect(report).not.toContain("**Retries:**");
  });

  test("timeout is included in Failed Jobs section", () => {
    const report = generateReport([makeResult({ status: "timeout" })], 10);
    expect(report).toContain("## Failed Jobs");
  });
});

// ---------------------------------------------------------------------------
// Next Steps
// ---------------------------------------------------------------------------

describe("generateReport – Next Steps", () => {
  test("shows success message when there are no failures", () => {
    const report = generateReport([makeResult()], 10);
    expect(report).toContain("All jobs completed successfully");
  });

  test("shows todo checkboxes for failed jobs", () => {
    const report = generateReport([makeResult({ status: "failed" })], 10);
    expect(report).toContain("- [ ]");
  });

  test("does not show todo checkboxes when all succeed", () => {
    const report = generateReport([makeResult()], 10);
    expect(report).not.toContain("- [ ]");
  });
});
