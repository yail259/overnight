import { expect, test, describe } from "bun:test";
import { formatDuration } from "./utils.js";

// ---------------------------------------------------------------------------
// formatDuration – sub-minute (seconds branch)
// ---------------------------------------------------------------------------

describe("formatDuration – seconds branch", () => {
  test("formats 0 seconds", () => {
    expect(formatDuration(0)).toBe("0.0s");
  });

  test("formats a fractional second with default 1 decimal place", () => {
    expect(formatDuration(45.5)).toBe("45.5s");
  });

  test("formats 59.9 seconds (just below threshold)", () => {
    expect(formatDuration(59.9)).toBe("59.9s");
  });

  test("respects custom decimalPlaces = 0", () => {
    expect(formatDuration(45.7, 0)).toBe("46s");
  });

  test("respects custom decimalPlaces = 2", () => {
    expect(formatDuration(3.14, 2)).toBe("3.14s");
  });
});

// ---------------------------------------------------------------------------
// formatDuration – minutes branch (60s – 3599s)
// ---------------------------------------------------------------------------

describe("formatDuration – minutes branch", () => {
  test("formats exactly 60 seconds as 1m 0s", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  test("formats 125 seconds as 2m 5s", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  test("formats 3599 seconds (just below 1 hour)", () => {
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  test("ignores decimalPlaces in the minutes branch", () => {
    // decimalPlaces only affects the seconds branch
    expect(formatDuration(90, 0)).toBe("1m 30s");
    expect(formatDuration(90, 2)).toBe("1m 30s");
  });
});

// ---------------------------------------------------------------------------
// formatDuration – hours branch (>= 3600s)
// ---------------------------------------------------------------------------

describe("formatDuration – hours branch", () => {
  test("formats exactly 1 hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
  });

  test("formats 1 hour 2 minutes", () => {
    expect(formatDuration(3750)).toBe("1h 2m");
  });

  test("formats 2 hours 3 minutes", () => {
    expect(formatDuration(7384)).toBe("2h 3m");
  });

  test("does not include seconds in the hours branch", () => {
    // Seconds are intentionally truncated at the hours level
    const result = formatDuration(3661); // 1h 1m 1s
    expect(result).toBe("1h 1m");
    expect(result).not.toContain("s");
  });
});
