<svelte:head>
	<title>overnight — it learns how you think</title>
	<meta name="description" content="overnight builds a profile of how you code, then predicts what you'd type in Claude Code while you sleep. Adaptive prediction, not batch automation." />
	<meta property="og:title" content="overnight — it learns how you think" />
	<meta property="og:description" content="Builds a profile of how you code. Predicts what you'd type next. Executes it while you sleep." />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://workovernight.com" />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="canonical" href="https://workovernight.com" />
</svelte:head>

<script lang="ts">
	let copied = $state(false);

	function copyInstall() {
		navigator.clipboard.writeText('npm install -g @yail259/overnight');
		copied = true;
		setTimeout(() => copied = false, 2000);
	}
</script>

<div class="grain">
<div class="relative min-h-screen bg-void">

	<!-- Nav -->
	<nav class="fixed top-0 z-40 w-full backdrop-blur-md bg-void/70">
		<div class="mx-auto flex h-14 max-w-[820px] items-center justify-between px-6">
			<a href="/" class="font-display text-lg text-cream italic">overnight</a>
			<div class="flex items-center gap-5">
				<a href="#profile" class="hidden sm:block text-[13px] text-cream-faint hover:text-cream transition-colors duration-300">Profile</a>
				<a href="#how" class="hidden sm:block text-[13px] text-cream-faint hover:text-cream transition-colors duration-300">How it works</a>
				<a
					href="https://github.com/yail259/overnight"
					target="_blank"
					rel="noopener noreferrer"
					aria-label="GitHub"
					class="text-cream-faint hover:text-cream transition-colors duration-300"
				>
					<svg class="h-[17px] w-[17px]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
				</a>
			</div>
		</div>
	</nav>

	<!-- ════════════ HERO ════════════ -->
	<section class="relative flex min-h-svh flex-col items-center justify-center px-6 overflow-hidden">
		<div class="absolute inset-0">
			<div class="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 h-[500px] w-[700px] rounded-full opacity-25" style="background: radial-gradient(ellipse, rgba(125,211,252,0.07) 0%, transparent 70%);"></div>
		</div>

		<div class="relative z-10 mx-auto max-w-[820px] w-full text-center">
			<p class="rise mb-6 font-mono text-[10px] tracking-[0.3em] uppercase text-moon">Open Source</p>
			<h1 class="rise rise-1 font-display text-[2.75rem] leading-[1.05] sm:text-[4.5rem] md:text-[5.5rem]">
				It learns how<br /><span class="italic text-moon">you think</span>
			</h1>
			<p class="rise rise-2 mx-auto mt-6 max-w-[520px] text-[15px] leading-relaxed text-cream-dim sm:text-[17px]">
				overnight reads your Claude Code sessions, builds a profile of how you code, and predicts what you'd type next — then executes it while you sleep.
			</p>
			<div class="rise rise-3 mt-10 flex justify-center">
				<button
					onclick={copyInstall}
					class="group flex items-center gap-2.5 rounded-full border border-border bg-surface/50 px-5 py-3 font-mono text-[12px] sm:text-[13px] backdrop-blur-sm transition-all duration-300 hover:border-cream-faint/40"
				>
					<span class="text-cream-faint">$</span>
					<span class="text-cream">npm install -g @yail259/overnight</span>
					<span class="ml-1 text-cream-faint group-hover:text-cream transition-colors duration-300">
						{#if copied}
							<svg class="h-3.5 w-3.5 text-signal" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						{:else}
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
						{/if}
					</span>
				</button>
			</div>
		</div>
	</section>

	<!-- ════════════ THE PROFILE ════════════ -->
	<section id="profile" class="px-6 pt-32 sm:pt-40 pb-24 sm:pb-32">
		<div class="mx-auto max-w-[820px]">
			<p class="font-mono text-[10px] tracking-[0.3em] uppercase text-moon">The Profile</p>
			<h2 class="mt-4 font-display text-[2rem] leading-[1.1] sm:text-[3rem] md:text-[3.5rem]">
				Not a task runner. <span class="italic text-cream-dim">A model of you.</span>
			</h2>
			<p class="mt-5 max-w-[560px] text-[15px] leading-relaxed text-cream-dim">
				overnight analyses your Claude Code conversations and extracts a profile — your communication style, coding patterns, technical values, and current focus. This is what makes predictions sound like you, not a generic prompt.
			</p>

			<!-- Profile dossier — single column, narrow, dense -->
			<div class="mt-16 max-w-[560px]">
				<div class="h-px bg-gradient-to-r from-moon/20 via-moon/10 to-transparent" style="animation: pulse-glow 4s ease-in-out infinite;"></div>

				<p class="mt-6 font-mono text-[10px] tracking-[0.3em] uppercase text-cream-faint">Extracted from 47 conversations</p>

				<div class="mt-8 space-y-6">
					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Communication</p>
						<p class="mt-2 text-[14px] leading-relaxed text-cream">Terse, imperative. Starts messages with verbs. Prefers 1-2 sentence instructions. Rarely explains motivation — just says what to do.</p>
					</div>
					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Stack</p>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each ['TypeScript', 'Svelte 5', 'Bun', 'React Ink', 'zod'] as tag}
								<span class="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] text-cream-dim">{tag}</span>
							{/each}
						</div>
						<p class="mt-2.5 text-[14px] text-cream-dim">Favours small modules, avoids classes. Explicit over DRY when readability suffers.</p>
					</div>
					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Values</p>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each ['ship fast', 'minimal abstractions', 'no dead code', 'test what matters'] as value}
								<span class="rounded-full bg-moon-glow px-2.5 py-0.5 font-mono text-[11px] text-moon">{value}</span>
							{/each}
						</div>
					</div>
					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Focus</p>
						<p class="mt-2 text-[14px] text-cream">Interactive TUI — streaming, approval flow, error recovery. Refactoring executor for retry resilience.</p>
					</div>
				</div>

				<div class="mt-8 h-px bg-border"></div>
			</div>

			<!-- What the profile enables -->
			<div class="mt-16 max-w-[560px]">
				<p class="text-[15px] font-semibold text-cream">The predictor never sees your raw conversations.</p>
				<p class="mt-3 text-[14px] leading-relaxed text-cream-dim">
					It receives three inputs: <strong class="text-cream font-normal">who you are</strong> (the profile above), <strong class="text-cream font-normal">where you're headed</strong> (direction extracted from recent work), and <strong class="text-cream font-normal">what exists</strong> (workspace — files, branches, tests). One output: the exact message you'd type next.
				</p>

				<div class="mt-8">
					<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Example prediction</p>
					<div class="mt-3 rounded-lg bg-surface-1 px-4 py-3.5 font-mono text-[12px] sm:text-[13px] leading-relaxed">
						<span class="text-cream-faint">&gt;</span> <span class="text-cream">add retry with exponential backoff to the executor's claude -p calls. wrap the stream consumption in a try/catch, max 3 retries. don't retry on 4xx.</span>
					</div>
					<p class="mt-2.5 text-[12px] text-cream-faint">Generated from profile + workspace state. Not a template — a message in your voice.</p>
				</div>
			</div>
		</div>
	</section>

	<!-- ════════════ ADAPTIVE LOOP ════════════ -->
	<section id="how" class="px-6 pt-32 sm:pt-40 pb-24 sm:pb-32">
		<div class="mx-auto max-w-[820px]">
			<p class="font-mono text-[10px] tracking-[0.3em] uppercase text-moon">How It Works</p>
			<h2 class="mt-4 font-display text-[2rem] leading-[1.1] sm:text-[3rem] md:text-[3.5rem]">
				Each step sees <span class="italic text-cream-dim">what the last one did.</span>
			</h2>
			<p class="mt-5 max-w-[560px] text-[15px] leading-relaxed text-cream-dim">
				Traditional automation fires a batch and hopes. overnight predicts one message, executes it, reads the result, and decides what to do next.
			</p>

			<!-- Loop steps -->
			<div class="mt-16 max-w-[480px] space-y-10">
				<div class="flex items-start gap-4">
					<span class="mt-0.5 font-mono text-[13px] text-moon">01</span>
					<div>
						<p class="text-[15px] font-semibold text-cream">Predict</p>
						<p class="mt-1 text-[14px] text-cream-dim">Profile + workspace + previous results &rarr; next message</p>
					</div>
				</div>
				<div class="flex items-start gap-4">
					<span class="mt-0.5 font-mono text-[13px] text-cream-dim">02</span>
					<div>
						<p class="text-[15px] font-semibold text-cream">Execute</p>
						<p class="mt-1 text-[14px] text-cream-dim">Run via <code class="font-mono text-[13px]">claude -p</code> with auto permissions</p>
					</div>
				</div>
				<div class="flex items-start gap-4">
					<span class="mt-0.5 font-mono text-[13px] text-cream-dim">03</span>
					<div>
						<p class="text-[15px] font-semibold text-cream">Observe</p>
						<p class="mt-1 text-[14px] text-cream-dim">Read output, diff, test status, build result</p>
					</div>
				</div>
				<div class="flex items-start gap-4">
					<span class="mt-0.5 font-mono text-[13px] text-moon">04</span>
					<div>
						<p class="text-[15px] font-semibold text-cream">Adapt</p>
						<p class="mt-1 text-[14px] text-cream-dim">Feed results back. Tests failed? Fix them. Build broke? Course-correct. Done? Stop.</p>
					</div>
				</div>
			</div>

			<!-- Modes + ambition — compact -->
			<div class="mt-20 grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-10 max-w-[560px]">
				<div>
					<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Run Modes</p>
					<div class="mt-4 space-y-3">
						<div>
							<p class="text-[14px] font-semibold text-cream">Stick to plan</p>
							<p class="text-[13px] text-cream-dim">One sprint. Hit the goals, then stop.</p>
						</div>
						<div>
							<p class="text-[14px] font-semibold text-cream">Don't stop</p>
							<p class="text-[13px] text-cream-dim">After goals: docs, tests, cleanup. Runs till morning.</p>
						</div>
					</div>
				</div>
				<div>
					<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Ambition</p>
					<div class="mt-4 space-y-3">
						<div>
							<span class="font-mono text-[13px] text-cream">safe</span>
							<span class="text-[13px] text-cream-dim"> — tests, docs, cleanup</span>
						</div>
						<div>
							<span class="font-mono text-[13px] text-cream">normal</span>
							<span class="text-[13px] text-cream-dim"> — natural next steps</span>
						</div>
						<div>
							<span class="font-mono text-[13px] text-cream">yolo</span>
							<span class="text-[13px] text-cream-dim"> — bold refactors, new features</span>
						</div>
					</div>
				</div>
			</div>

			<div class="mt-12 max-w-[560px] rounded-lg bg-signal-dim px-5 py-4">
				<p class="text-[14px] text-cream">
					<strong class="text-signal font-semibold">Zero risk to main.</strong> Everything on <code class="font-mono text-[12px]">overnight/&#123;run-id&#125;</code>. Review in the morning. Merge what you like.
				</p>
			</div>
		</div>
	</section>

	<!-- ════════════ TERMINAL ════════════ -->
	<section class="px-6 pt-20 sm:pt-28 pb-24 sm:pb-32">
		<div class="mx-auto max-w-[720px]">
			<div class="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/40">
				<div class="flex items-center gap-1.5 border-b border-border bg-surface-1 px-4 py-2.5">
					<div class="h-2.5 w-2.5 rounded-full bg-hot/50"></div>
					<div class="h-2.5 w-2.5 rounded-full bg-warm/50"></div>
					<div class="h-2.5 w-2.5 rounded-full bg-signal/50"></div>
					<span class="ml-3 font-mono text-[10px] text-cream-faint">overnight</span>
				</div>
				<div class="p-5 sm:p-6 font-mono text-[11px] sm:text-[12px] leading-6 sm:leading-7 overflow-x-auto">
					<p><span class="text-cream-faint">$</span> <span class="text-cream">overnight</span></p>
					<p class="mt-4 text-cream-faint">Scanning ~/.claude/projects/ ...</p>
					<p class="text-cream-faint">Built profile from <span class="text-cream">47 conversations</span> <span class="text-cream-faint">(234 turns)</span></p>
					<p class="mt-4 text-cream-dim">Suggested plan:</p>
					<p class="text-cream ml-2">"The executor has no retry logic and the error types are</p>
					<p class="text-cream ml-2"> incomplete. Want me to finish it tonight?"</p>
					<p class="mt-4 text-cream-faint">Ambition: <span class="text-cream">normal</span> &nbsp;Mode: <span class="text-cream">stick to plan</span></p>
					<p class="mt-4 text-signal">&#9656; Starting run <span class="text-cream">overnight/run-a7f3</span></p>
					<p class="mt-2"><span class="text-signal">&#10003;</span> <span class="text-cream-faint">1</span> <span class="text-cream">Add ExecutorError type + wrap stream calls</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">2</span> <span class="text-cream">Add exponential backoff — max 3 retries</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">3</span> <span class="text-cream">Write executor.test.ts — 12 test cases</span></p>
					<p><span class="text-warm">&#10003;</span> <span class="text-cream-faint">4</span> <span class="text-cream">Fix test — stream mock needed handler</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">5</span> <span class="text-cream">All 12 tests passing. Committed.</span></p>
					<p class="mt-4 text-signal">Done <span class="text-cream-faint">— 5 steps, 4m 32s, $0.18</span></p>
				</div>
			</div>
		</div>
	</section>

	<!-- ════════════ CTA ════════════ -->
	<section class="relative px-6 pt-20 sm:pt-28 pb-32 sm:pb-40">
		<div class="absolute inset-0 overflow-hidden">
			<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] rounded-full" style="background: radial-gradient(ellipse, rgba(125,211,252,0.03) 0%, transparent 70%);"></div>
		</div>
		<div class="relative z-10 mx-auto max-w-[820px] text-center">
			<h2 class="font-display text-[2.5rem] leading-[1.05] sm:text-[3.5rem] md:text-[4.5rem]">
				Ship while <span class="italic text-moon">you sleep</span>
			</h2>
			<p class="mx-auto mt-5 max-w-[440px] text-[15px] text-cream-dim">
				Describe what you want done. Wake up to a branch full of working code, committed in your style.
			</p>
			<div class="mt-10 flex justify-center">
				<button
					onclick={copyInstall}
					class="group flex items-center gap-2.5 rounded-full border border-border bg-surface/50 px-5 py-3 font-mono text-[12px] sm:text-[13px] backdrop-blur-sm transition-all duration-300 hover:border-cream-faint/40"
				>
					<span class="text-cream-faint">$</span>
					<span class="text-cream">npm install -g @yail259/overnight</span>
					<span class="ml-1 text-cream-faint group-hover:text-cream transition-colors duration-300">
						{#if copied}
							<svg class="h-3.5 w-3.5 text-signal" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						{:else}
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
						{/if}
					</span>
				</button>
			</div>
			<div class="mt-6 flex flex-col items-center gap-1 font-mono text-[11px] sm:text-[12px] text-cream-faint">
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight</span> <span class="text-cream-faint"># interactive TUI</span></p>
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight start "finish auth and add tests"</span></p>
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight log</span> <span class="text-cream-faint"># morning review</span></p>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer>
		<div class="h-px bg-border mx-6"></div>
		<div class="mx-auto flex max-w-[820px] items-center justify-between px-6 py-6">
			<span class="font-display text-sm italic text-cream-faint">overnight</span>
			<div class="flex items-center gap-5">
				<a href="https://www.npmjs.com/package/@yail259/overnight" target="_blank" rel="noopener noreferrer" class="font-mono text-[11px] text-cream-faint hover:text-cream transition-colors duration-300">npm</a>
				<a href="https://github.com/yail259/overnight" target="_blank" rel="noopener noreferrer" class="font-mono text-[11px] text-cream-faint hover:text-cream transition-colors duration-300">GitHub</a>
				<span class="font-mono text-[11px] text-cream-faint">MIT</span>
			</div>
		</div>
	</footer>
</div>
</div>
