import { expect, test, describe } from "bun:test";
import { matchesPattern, isPathWithinSandbox } from "./security.js";

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------

describe("matchesPattern", () => {
  // Basic ** glob matching
  test("matches exact filename anywhere via **", () => {
    expect(matchesPattern(".env", "**/.env")).toBe(true);
    expect(matchesPattern("config/.env", "**/.env")).toBe(true);
    expect(matchesPattern("a/b/c/.env", "**/.env")).toBe(true);
  });

  test("does not match different filename", () => {
    expect(matchesPattern(".envrc", "**/.env")).toBe(false);
    expect(matchesPattern("dotenv", "**/.env")).toBe(false);
  });

  test("dots in pattern are treated as literals, not regex wildcards", () => {
    // 'X' should not match the literal '.' in '**/.env'
    expect(matchesPattern("fooXenv", "**/.env")).toBe(false);
  });

  // * vs ** semantics
  test("* matches within a single path segment", () => {
    expect(matchesPattern("secret.key", "*.key")).toBe(true);
  });

  // Note: due to the (^|/) prefix added for relative patterns, a bare `*.key`
  // pattern still matches files in subdirectories (anchored at each `/`). This
  // is intentional for deny-lists — all deny patterns already use `**/*.key`.
  test("* pattern matches file in any subdirectory via anchor", () => {
    expect(matchesPattern("foo/secret.key", "*.key")).toBe(true);
  });

  test("** matches across multiple path segments", () => {
    expect(matchesPattern("deep/nested/secret.key", "**/*.key")).toBe(true);
    expect(matchesPattern("secret.key", "**/*.key")).toBe(true);
  });

  // Default deny patterns
  test("matches .env with dotenv suffix pattern", () => {
    expect(matchesPattern(".env.local", "**/.env.*")).toBe(true);
    expect(matchesPattern("config/.env.production", "**/.env.*")).toBe(true);
  });

  test("matches credentials files", () => {
    expect(matchesPattern("credentials.json", "**/credentials*")).toBe(true);
    expect(matchesPattern("config/credentials.yml", "**/credentials*")).toBe(true);
  });

  test("matches .pem certificate files", () => {
    expect(matchesPattern("server.pem", "**/*.pem")).toBe(true);
    expect(matchesPattern("certs/server.pem", "**/*.pem")).toBe(true);
  });

  test("matches SSH key files", () => {
    expect(matchesPattern("id_rsa", "**/id_rsa*")).toBe(true);
    expect(matchesPattern("/home/user/.ssh/id_rsa.pub", "**/id_rsa*")).toBe(true);
    expect(matchesPattern("id_ed25519", "**/id_ed25519*")).toBe(true);
  });

  test("matches files inside .ssh directory", () => {
    expect(matchesPattern("/home/user/.ssh/config", "**/.ssh/*")).toBe(true);
    expect(matchesPattern(".ssh/known_hosts", "**/.ssh/*")).toBe(true);
  });

  test("matches files inside .aws directory", () => {
    expect(matchesPattern("/home/user/.aws/credentials", "**/.aws/*")).toBe(true);
    expect(matchesPattern(".aws/config", "**/.aws/*")).toBe(true);
  });

  test("matches .npmrc", () => {
    expect(matchesPattern(".npmrc", "**/.npmrc")).toBe(true);
    expect(matchesPattern("project/.npmrc", "**/.npmrc")).toBe(true);
  });

  test("matches .netrc", () => {
    expect(matchesPattern(".netrc", "**/.netrc")).toBe(true);
  });

  test("matches .git/config", () => {
    expect(matchesPattern(".git/config", "**/.git/config")).toBe(true);
  });

  test("does not match unrelated files", () => {
    expect(matchesPattern("src/index.ts", "**/.env")).toBe(false);
    expect(matchesPattern("README.md", "**/*.key")).toBe(false);
    expect(matchesPattern("package.json", "**/credentials*")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPathWithinSandbox
// ---------------------------------------------------------------------------

describe("isPathWithinSandbox", () => {
  const sandbox = "/tmp/test-sandbox-overnight";

  test("returns true for a file directly inside sandbox", () => {
    expect(isPathWithinSandbox(`${sandbox}/file.txt`, sandbox)).toBe(true);
  });

  test("returns true for a deeply nested file inside sandbox", () => {
    expect(isPathWithinSandbox(`${sandbox}/a/b/c/deep.txt`, sandbox)).toBe(true);
  });

  test("returns false for a file outside the sandbox", () => {
    expect(isPathWithinSandbox("/tmp/other/file.txt", sandbox)).toBe(false);
  });

  test("returns false for the parent directory of the sandbox", () => {
    expect(isPathWithinSandbox("/tmp", sandbox)).toBe(false);
  });

  test("returns false for a sibling directory", () => {
    expect(isPathWithinSandbox("/tmp/other-sandbox/file.txt", sandbox)).toBe(false);
  });

  test("path traversal attack is blocked", () => {
    // resolve() normalises away the ../.. so this should be outside
    expect(isPathWithinSandbox(`${sandbox}/../../etc/passwd`, sandbox)).toBe(false);
  });

  test("accepts a relative sandbox dir resolved from cwd", () => {
    // "." as sandbox means CWD; a file inside CWD should be allowed
    const fileInsideCwd = process.cwd() + "/src/security.ts";
    expect(isPathWithinSandbox(fileInsideCwd, ".")).toBe(true);
  });

  test("rejects a file outside a relative sandbox dir", () => {
    expect(isPathWithinSandbox("/etc/passwd", ".")).toBe(false);
  });
});
