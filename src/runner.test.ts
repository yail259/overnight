import { expect, test, describe, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import {
  taskKey,
  taskHash,
  resultsToJson,
  saveState,
  loadState,
  clearState,
  validateDag,
  depsReady,
} from "./runner.js";
import type { JobConfig, JobResult, RunState } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<JobResult> = {}): JobResult {
  return {
    task: "Do something",
    status: "success",
    duration_seconds: 5,
    verified: false,
    retries: 0,
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobConfig> = {}): JobConfig {
  return { prompt: "Run a task", ...overrides };
}

const TMP_STATE = join(tmpdir(), `runner-test-${process.pid}.json`);

// ---------------------------------------------------------------------------
// taskKey
// ---------------------------------------------------------------------------

describe("taskKey", () => {
  test("returns the id when explicitly set", () => {
    const job = makeJob({ id: "my-task" });
    expect(taskKey(job)).toBe("my-task");
  });

  test("returns a 12-char hex hash when id is absent", () => {
    const job = makeJob({ prompt: "do something" });
    const key = taskKey(job);
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  test("is deterministic — same prompt gives same key", () => {
    const a = makeJob({ prompt: "hello world" });
    const b = makeJob({ prompt: "hello world" });
    expect(taskKey(a)).toBe(taskKey(b));
  });

  test("different prompts produce different keys", () => {
    expect(taskKey(makeJob({ prompt: "task A" }))).not.toBe(
      taskKey(makeJob({ prompt: "task B" }))
    );
  });
});

// ---------------------------------------------------------------------------
// taskHash (deprecated wrapper)
// ---------------------------------------------------------------------------

describe("taskHash", () => {
  test("returns a 12-char hex string", () => {
    expect(taskHash("some prompt")).toMatch(/^[0-9a-f]{12}$/);
  });

  test("is deterministic", () => {
    expect(taskHash("abc")).toBe(taskHash("abc"));
  });

  test("matches taskKey for the same prompt (no id)", () => {
    const prompt = "shared prompt";
    expect(taskHash(prompt)).toBe(taskKey(makeJob({ prompt })));
  });
});

// ---------------------------------------------------------------------------
// resultsToJson
// ---------------------------------------------------------------------------

describe("resultsToJson", () => {
  test("returns a valid JSON string", () => {
    const json = resultsToJson([makeResult()]);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test("serialises an empty array", () => {
    expect(JSON.parse(resultsToJson([]))).toEqual([]);
  });

  test("preserves all fields of a JobResult", () => {
    const r = makeResult({ task: "t", status: "failed", error: "oops", retries: 2 });
    const parsed = JSON.parse(resultsToJson([r]));
    expect(parsed[0].task).toBe("t");
    expect(parsed[0].status).toBe("failed");
    expect(parsed[0].error).toBe("oops");
    expect(parsed[0].retries).toBe(2);
  });

  test("output is pretty-printed (contains newlines)", () => {
    expect(resultsToJson([makeResult()])).toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// saveState / loadState / clearState
// ---------------------------------------------------------------------------

describe("saveState / loadState / clearState", () => {
  afterEach(() => {
    // Clean up temp file after each test
    if (existsSync(TMP_STATE)) clearState(TMP_STATE);
  });

  const state: RunState = {
    completed: {
      abc123: makeResult({ task: "saved task" }),
    },
    timestamp: new Date().toISOString(),
  };

  test("loadState returns null when file does not exist", () => {
    expect(loadState(TMP_STATE)).toBeNull();
  });

  test("saveState writes and loadState reads back the same data", () => {
    saveState(state, TMP_STATE);
    const loaded = loadState(TMP_STATE);
    expect(loaded).not.toBeNull();
    expect(loaded!.completed["abc123"].task).toBe("saved task");
    expect(loaded!.timestamp).toBe(state.timestamp);
  });

  test("clearState removes the file", () => {
    saveState(state, TMP_STATE);
    expect(existsSync(TMP_STATE)).toBe(true);
    clearState(TMP_STATE);
    expect(existsSync(TMP_STATE)).toBe(false);
  });

  test("clearState is a no-op when file does not exist", () => {
    expect(() => clearState(TMP_STATE)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateDag
// ---------------------------------------------------------------------------

describe("validateDag", () => {
  test("returns null for an empty task list", () => {
    expect(validateDag([])).toBeNull();
  });

  test("returns null when tasks have no dependencies", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" })];
    expect(validateDag(jobs)).toBeNull();
  });

  test("returns null for a valid linear chain A → B → C", () => {
    const jobs: JobConfig[] = [
      makeJob({ id: "a" }),
      makeJob({ id: "b", depends_on: ["a"] }),
      makeJob({ id: "c", depends_on: ["b"] }),
    ];
    expect(validateDag(jobs)).toBeNull();
  });

  test("returns null for a valid diamond A←B, A←C, B←D, C←D", () => {
    const jobs: JobConfig[] = [
      makeJob({ id: "a" }),
      makeJob({ id: "b", depends_on: ["a"] }),
      makeJob({ id: "c", depends_on: ["a"] }),
      makeJob({ id: "d", depends_on: ["b", "c"] }),
    ];
    expect(validateDag(jobs)).toBeNull();
  });

  test("returns an error string for an unknown dependency", () => {
    const jobs: JobConfig[] = [makeJob({ id: "a", depends_on: ["ghost"] })];
    const result = validateDag(jobs);
    expect(result).not.toBeNull();
    expect(result).toContain("ghost");
  });

  test("returns an error string for a direct cycle A ↔ B", () => {
    const jobs: JobConfig[] = [
      makeJob({ id: "a", depends_on: ["b"] }),
      makeJob({ id: "b", depends_on: ["a"] }),
    ];
    const result = validateDag(jobs);
    expect(result).not.toBeNull();
    expect(result).toContain("cycle");
  });

  test("returns an error string for an indirect cycle A→B→C→A", () => {
    const jobs: JobConfig[] = [
      makeJob({ id: "a", depends_on: ["c"] }),
      makeJob({ id: "b", depends_on: ["a"] }),
      makeJob({ id: "c", depends_on: ["b"] }),
    ];
    const result = validateDag(jobs);
    expect(result).not.toBeNull();
    expect(result).toContain("cycle");
  });

  test("tasks without ids are ignored in cycle detection", () => {
    // Anonymous tasks can't be depended on, so no cycle possible
    const jobs = [makeJob(), makeJob()];
    expect(validateDag(jobs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// depsReady
// ---------------------------------------------------------------------------

describe("depsReady", () => {
  test("returns 'ready' when there are no dependencies", () => {
    expect(depsReady(makeJob(), {})).toBe("ready");
  });

  test("returns 'ready' when depends_on is an empty array", () => {
    expect(depsReady(makeJob({ depends_on: [] }), {})).toBe("ready");
  });

  test("returns 'ready' when all deps have succeeded", () => {
    const completed = { a: makeResult({ status: "success" }) };
    expect(depsReady(makeJob({ depends_on: ["a"] }), completed)).toBe("ready");
  });

  test("returns 'waiting' when a dep has not completed yet", () => {
    expect(depsReady(makeJob({ depends_on: ["missing"] }), {})).toBe("waiting");
  });

  test("returns 'blocked' when a dep has failed", () => {
    const completed = { a: makeResult({ status: "failed" }) };
    expect(depsReady(makeJob({ depends_on: ["a"] }), completed)).toBe("blocked");
  });

  test("returns 'blocked' when a dep has timed out", () => {
    const completed = { a: makeResult({ status: "timeout" }) };
    expect(depsReady(makeJob({ depends_on: ["a"] }), completed)).toBe("blocked");
  });

  test("returns 'blocked' when a dep has verification_failed", () => {
    const completed = { a: makeResult({ status: "verification_failed" }) };
    expect(depsReady(makeJob({ depends_on: ["a"] }), completed)).toBe("blocked");
  });

  test("returns 'waiting' if any dep is missing even when others succeeded", () => {
    const completed = { a: makeResult({ status: "success" }) };
    expect(depsReady(makeJob({ depends_on: ["a", "b"] }), completed)).toBe("waiting");
  });

  test("returns 'blocked' if any dep failed even when others succeeded", () => {
    const completed = {
      a: makeResult({ status: "success" }),
      b: makeResult({ status: "failed" }),
    };
    expect(depsReady(makeJob({ depends_on: ["a", "b"] }), completed)).toBe("blocked");
  });
});
