import type { EvolveConfig, EvolveState, EvolvePlan } from "../types.js";

export function buildEvolveSystemPrompt(config: EvolveConfig): string {
  const protectedList = [
    ...(config.protected_files ?? []),
    "src/evolve/guardrails.ts",
  ];

  return `You are an autonomous software engineer improving the "${config.name}" codebase.

## Mission
Analyze the codebase, identify one well-scoped improvement, implement it, verify it works, and propose it via a pull request. You operate in a continuous loop — each cycle is one improvement.

## Principles
1. Small, focused changes — each PR does one thing well
2. Always verify — run build and tests before proposing
3. Conservative — prefer safe refactors over risky rewrites
4. Explain reasoning — PRs have clear descriptions

## Guardrails (HARD RULES)
1. Never modify protected files: ${protectedList.join(", ")}
2. Never force push or push to ${config.base_branch}
3. Max ${config.max_files_per_cycle ?? 10} files changed per cycle
4. Max ${config.max_lines_changed_per_cycle ?? 500} lines changed per cycle
5. Stay within the project directory — never access files outside it
6. Never weaken or remove guardrail logic
7. Never modify package.json or lock files

${config.focus_areas?.length ? `## Focus Areas\n${config.focus_areas.join(", ")}` : ""}

## Session Continuity
You run in a persistent session. Prior cycle context is available.
Learn from previous cycles — don't repeat failed approaches.`;
}

export function buildObservePlanPrompt(
  config: EvolveConfig,
  state: EvolveState,
  roadmapContent?: string,
): string {
  // Summarize last 5 cycles so the agent learns from history
  const recentCycles = state.completed_cycles.slice(-5);
  const historyBlock = recentCycles.length
    ? `## Previous Cycles\n${recentCycles.map((c, i) => {
        const status = c.verify_passed ? "OK" : "FAILED";
        return `${i + 1}. [${status}] ${c.plan_summary} → ${c.phase_reached}${c.pr_url ? ` (${c.pr_url})` : ""}${c.error ? ` — ${c.error}` : ""}`;
      }).join("\n")}\n`
    : "";

  const roadmapBlock = roadmapContent
    ? `## Roadmap\n${roadmapContent}\n`
    : "";

  return `Evolution cycle #${state.cycle_count}.

${historyBlock}${roadmapBlock}## Your Task (Phase 1: Observe + Plan)

Analyze the codebase thoroughly:
1. Read key source files to understand the current architecture
2. Run \`git log --oneline -20\` to see recent changes
3. Run the build to check current state: \`bun run build 2>&1\`
4. Search for TODOs, FIXMEs, and HACKs in the source
5. Look for test coverage gaps, missing error handling, type issues
${roadmapContent ? "6. Check the roadmap for prioritized items" : ""}

Then output a structured plan as JSON:
- improvement_type: one of "bug_fix", "refactor", "test", "feature", "performance"
- title: short kebab-case slug for the branch name (<40 chars)
- description: what you will change and why (2-3 sentences)
- files_to_modify: list of files you expect to touch
- verification_commands: commands to verify your changes (e.g. ["bun run build"])
- risk_assessment: what could go wrong (1 sentence)

Prefer the SIMPLEST high-value change. Do NOT plan changes to protected files.
Do NOT repeat improvements from previous cycles.`;
}

export function buildExecutePrompt(plan: EvolvePlan): string {
  return `## Your Task (Phase 2: Execute)

Implement the following plan:

**${plan.title}** (${plan.improvement_type})
${plan.description}

Expected files: ${plan.files_to_modify.join(", ")}

Rules:
- Make ONLY the changes described in the plan
- Do not modify protected files
- Keep changes minimal and focused
- Use the check_cycle_budget tool to verify you're within limits before finishing
- If you encounter unexpected complexity, do what you can and note limitations

Go ahead and make the changes now.`;
}

export function buildVerifyPrompt(plan: EvolvePlan): string {
  const commands = plan.verification_commands.length
    ? plan.verification_commands.join(", ")
    : "bun run build";

  return `## Your Task (Phase 3: Verify)

Run verification and report results as structured JSON.

Commands to run:
${commands}

Also run:
- \`git diff --stat\` to see what changed

Report as JSON:
- all_passed: boolean (true only if ALL checks pass)
- build_passed: boolean
- tests_passed: boolean (true if no test runner configured — don't fail for missing tests)
- issues_found: list of any issues discovered (empty array if none)`;
}

export function buildProposePrompt(
  plan: EvolvePlan,
  branchName: string,
  config: EvolveConfig,
): string {
  return `## Your Task (Phase 4: Propose)

The changes verified successfully. Now commit and open a PR.

1. Stage all changes: \`git add -A\`
2. Commit with message: \`${plan.improvement_type}: ${plan.title}\`
   Include the plan description in the commit body.
   End with: Co-Authored-By: overnight-evolve <noreply@overnight.dev>
3. Push the branch: \`git push -u origin ${branchName}\`
4. Create a PR to ${config.base_branch}:
   Title: "${plan.title}"
   Body should include:
   - Summary of changes
   - Verification results
   - Risk assessment: ${plan.risk_assessment}
   - Footer: "Generated by \`overnight evolve\`"

Output the PR URL when done.`;
}
