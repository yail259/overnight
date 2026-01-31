import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { stringify as stringifyYaml } from "yaml";
import * as readline from "readline";
import {
  type GoalConfig,
  DEFAULT_TOOLS,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_CONVERGENCE_THRESHOLD,
  DEFAULT_DENY_PATTERNS,
} from "./types.js";

type LogCallback = (msg: string) => void;

// --- Claude executable ---

let claudeExecutablePath: string | undefined;

function findClaudeExecutable(): string | undefined {
  if (claudeExecutablePath !== undefined) return claudeExecutablePath;
  if (process.env.CLAUDE_CODE_PATH) {
    claudeExecutablePath = process.env.CLAUDE_CODE_PATH;
    return claudeExecutablePath;
  }
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    claudeExecutablePath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0];
    return claudeExecutablePath;
  } catch {
    const commonPaths = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) {
        claudeExecutablePath = p;
        return claudeExecutablePath;
      }
    }
  }
  return undefined;
}

// --- Interactive prompting ---

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// --- Planner ---

const PLANNER_SYSTEM_PROMPT = `You are an expert software architect helping plan an autonomous overnight build.

Your job is to have a focused design conversation with the user, then produce a goal.yaml file that an autonomous build agent will use to implement the project overnight.

Guidelines:
- Ask clarifying questions about scope, technology choices, priorities, and constraints
- Keep the conversation focused and efficient — 3-5 rounds max
- When you have enough information, produce the goal.yaml
- The goal.yaml should be specific enough for an agent to work autonomously
- Include concrete acceptance criteria that can be verified
- Include verification commands when possible (build, test, lint)
- Set realistic constraints

When you're ready to produce the final plan, output it in this format:

\`\`\`yaml
goal: "Clear description of what to build"

acceptance_criteria:
  - "Specific, verifiable criterion 1"
  - "Specific, verifiable criterion 2"

verification_commands:
  - "npm run build"
  - "npm test"

constraints:
  - "Don't modify existing API contracts"

max_iterations: 15
convergence_threshold: 3

defaults:
  timeout_seconds: 600
  allowed_tools:
    - Read
    - Edit
    - Write
    - Glob
    - Grep
    - Bash
  security:
    sandbox_dir: "."
    max_turns: 150
\`\`\`

IMPORTANT: Only output the yaml block when you and the user agree the plan is ready. Before that, ask questions and discuss.`;

export async function runPlanner(
  initialGoal: string,
  options: {
    outputFile?: string;
    log?: LogCallback;
  } = {}
): Promise<GoalConfig | null> {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const outputFile = options.outputFile ?? "goal.yaml";
  const claudePath = findClaudeExecutable();

  if (!claudePath) {
    log("\x1b[31m✗ Error: Could not find 'claude' CLI.\x1b[0m");
    return null;
  }

  log("\x1b[1movernight plan: Interactive design session\x1b[0m");
  log("\x1b[2mDescribe your goal and I'll help shape it into a plan.\x1b[0m");
  log("\x1b[2mType 'done' to finalize, 'quit' to abort.\x1b[0m\n");

  const rl = createReadline();
  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  // First turn: send the initial goal to the planner
  let currentPrompt = `The user wants to plan the following project for an overnight autonomous build:\n\n${initialGoal}\n\nAsk clarifying questions to understand scope, tech choices, priorities, and constraints. Be concise.`;

  try {
    let sessionId: string | undefined;

    for (let round = 0; round < 10; round++) {
      // Run Claude
      const sdkOptions: ClaudeCodeOptions = {
        allowedTools: ["Read", "Glob", "Grep"],  // Read-only for planning
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        permissionMode: "acceptEdits",
        pathToClaudeCodeExecutable: claudePath,
        ...(sessionId && { resume: sessionId }),
      };

      let result: string | undefined;

      const conversation = query({ prompt: currentPrompt, options: sdkOptions });
      for await (const message of conversation) {
        if (message.type === "result") {
          sessionId = message.session_id;
          if (message.subtype === "success") {
            result = message.result;
          }
        } else if (message.type === "system" && "subtype" in message) {
          if (message.subtype === "init") {
            sessionId = message.session_id;
          }
        }
      }

      if (!result) {
        log("\x1b[31m✗ No response from planner\x1b[0m");
        break;
      }

      conversationHistory.push({ role: "assistant", content: result });

      // Check if the planner produced a goal.yaml
      const yamlMatch = result.match(/```yaml\n([\s\S]*?)\n```/);
      if (yamlMatch) {
        // Show the plan
        log("\n\x1b[1m━━━ Proposed Plan ━━━\x1b[0m\n");
        log(yamlMatch[1]);
        log("\n\x1b[1m━━━━━━━━━━━━━━━━━━━━\x1b[0m\n");

        const answer = await ask(rl, "\x1b[36m?\x1b[0m Accept this plan? (yes/no/revise): ");

        if (answer.toLowerCase() === "yes" || answer.toLowerCase() === "y") {
          // Write the goal.yaml
          writeFileSync(outputFile, yamlMatch[1]);
          log(`\n\x1b[32m✓ Plan saved to ${outputFile}\x1b[0m`);
          log(`Run with: \x1b[1movernight run ${outputFile}\x1b[0m`);
          rl.close();

          // Parse and return
          const { parse: parseYaml } = await import("yaml");
          return parseYaml(yamlMatch[1]) as GoalConfig;
        } else if (answer.toLowerCase() === "quit" || answer.toLowerCase() === "q") {
          log("\x1b[33mAborted\x1b[0m");
          rl.close();
          return null;
        } else {
          // User wants revisions
          const revision = await ask(rl, "\x1b[36m?\x1b[0m What would you like to change? ");
          currentPrompt = revision;
          conversationHistory.push({ role: "user", content: revision });
          continue;
        }
      }

      // Show the assistant's response
      log(`\n\x1b[2m─── Planner ───\x1b[0m\n`);
      log(result);
      log("");

      // Get user input
      const userInput = await ask(rl, "\x1b[36m>\x1b[0m ");

      if (userInput.toLowerCase() === "done") {
        // Ask the planner to finalize
        currentPrompt = "The user is satisfied. Please produce the final goal.yaml now based on our discussion.";
        conversationHistory.push({ role: "user", content: currentPrompt });
        continue;
      }

      if (userInput.toLowerCase() === "quit" || userInput.toLowerCase() === "q") {
        log("\x1b[33mAborted\x1b[0m");
        rl.close();
        return null;
      }

      currentPrompt = userInput;
      conversationHistory.push({ role: "user", content: userInput });
    }
  } finally {
    rl.close();
  }

  log("\x1b[33m⚠ Design session ended without producing a plan\x1b[0m");
  return null;
}
