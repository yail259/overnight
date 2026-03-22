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
		<div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
			<a href="/" class="font-display text-xl text-cream italic tracking-wide">overnight</a>
			<div class="flex items-center gap-4 sm:gap-6">
				<a href="#profile" class="hidden sm:block text-sm text-cream-faint hover:text-cream transition-colors duration-300">The Profile</a>
				<a href="#loop" class="hidden sm:block text-sm text-cream-faint hover:text-cream transition-colors duration-300">How It Works</a>
				<a
					href="https://github.com/yail259/overnight"
					target="_blank"
					rel="noopener noreferrer"
					aria-label="GitHub"
					class="text-cream-faint hover:text-cream transition-colors duration-300"
				>
					<svg class="h-[18px] w-[18px]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
				</a>
			</div>
		</div>
	</nav>

	<!-- ═══════════════════════ HERO ═══════════════════════ -->
	<section class="relative flex min-h-svh flex-col items-center justify-center px-5 sm:px-8 overflow-hidden">
		<div class="absolute inset-0">
			<div class="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] sm:h-[600px] sm:w-[900px] rounded-full opacity-30" style="background: radial-gradient(ellipse, rgba(125,211,252,0.08) 0%, transparent 70%);"></div>
		</div>

		<div class="relative z-10 mx-auto max-w-4xl">
			<div class="rise text-center">
				<p class="mb-6 sm:mb-8 font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase text-moon">Open Source</p>
			</div>
			<h1 class="rise rise-1 text-center font-display text-[2.75rem] leading-[1.05] tracking-tight sm:text-7xl md:text-8xl lg:text-[6.5rem]">
				<span class="text-cream">It learns how</span><br />
				<span class="italic text-moon">you think</span>
			</h1>
			<p class="rise rise-2 mx-auto mt-6 sm:mt-10 max-w-2xl text-center text-base sm:text-lg leading-relaxed text-cream-dim sm:text-xl px-2">
				overnight reads your Claude Code sessions, builds a profile of your coding style, and uses it to predict what you'd type next — then executes it while you sleep.
			</p>

			<div class="rise rise-3 mt-10 sm:mt-14 flex justify-center">
				<button
					onclick={copyInstall}
					class="group relative flex items-center gap-2 sm:gap-3 rounded-full border border-border bg-surface/60 px-4 sm:px-6 py-3 sm:py-3.5 font-mono text-xs sm:text-sm backdrop-blur-sm transition-all duration-300 hover:border-moon/30 hover:bg-surface-1/80"
				>
					<span class="text-cream-faint">$</span>
					<span class="text-cream">npm install -g @yail259/overnight</span>
					<span class="ml-1 text-cream-faint group-hover:text-moon transition-colors duration-300">
						{#if copied}
							<svg class="h-4 w-4 text-signal" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
						{/if}
					</span>
				</button>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════ THE PROFILE ═══════════════════════ -->
	<section id="profile" class="relative px-5 sm:px-8 py-24 sm:py-40">
		<div class="mx-auto max-w-6xl">
			<div class="max-w-2xl">
				<p class="font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase text-moon">The Profile</p>
				<h2 class="mt-4 sm:mt-5 font-display text-3xl leading-[1.1] sm:text-5xl md:text-6xl">
					Not a task runner.<br />
					<span class="italic text-cream-dim">A model of you.</span>
				</h2>
				<p class="mt-5 sm:mt-6 text-base sm:text-lg leading-relaxed text-cream-dim">
					overnight analyses your Claude Code conversations and extracts a profile — your communication style, coding patterns, technical preferences, and what you care about. This profile is what makes predictions sound like <em>you</em>, not a generic prompt.
				</p>
			</div>

			<div class="mt-14 sm:mt-20 grid gap-16 lg:grid-cols-[1fr,1.2fr]">
				<!-- Profile visualization — borderless -->
				<div class="relative">
					<div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-moon/20 to-transparent" style="animation: pulse-glow 3s ease-in-out infinite;"></div>

					<p class="pt-8 font-mono text-[10px] tracking-[0.3em] uppercase text-cream-faint">overnight profile &mdash; extracted from 47 conversations</p>

					<div class="mt-8 space-y-8">
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-moon/70">Communication Style</p>
							<p class="mt-2.5 text-sm leading-relaxed text-cream">Terse, imperative. Starts messages with verbs. Prefers 1-2 sentence instructions. Rarely explains motivation — just says what to do.</p>
						</div>
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-moon/70">Coding Patterns</p>
							<div class="mt-2.5 flex flex-wrap gap-2">
								{#each ['TypeScript', 'Svelte 5', 'Bun', 'React Ink', 'zod'] as tag}
									<span class="rounded-full bg-surface-2 px-3 py-1 font-mono text-xs text-cream-dim">{tag}</span>
								{/each}
							</div>
							<p class="mt-3 text-sm text-cream-dim">Favours small modules, avoids classes. Prefers explicit over DRY when readability suffers.</p>
						</div>
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-moon/70">Values</p>
							<div class="mt-2.5 flex flex-wrap gap-2">
								{#each ['ship fast', 'minimal abstractions', 'no dead code', 'test what matters'] as value}
									<span class="rounded-full bg-moon-glow px-3 py-1 font-mono text-xs text-moon">{value}</span>
								{/each}
							</div>
						</div>
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-moon/70">Current Focus</p>
							<p class="mt-2.5 text-sm text-cream">Interactive TUI — streaming, approval flow, error recovery. Refactoring executor for retry resilience.</p>
						</div>
					</div>
				</div>

				<!-- What this enables -->
				<div class="space-y-10">
					<div>
						<p class="font-mono text-[10px] tracking-[0.3em] uppercase text-cream-faint">What this enables</p>
						<h3 class="mt-4 font-display text-2xl italic leading-snug sm:text-3xl">Predictions that<br />sound like you typed them</h3>
						<p class="mt-4 text-sm leading-relaxed text-cream-dim">
							The predictor never sees your raw conversations. It sees <strong class="text-cream">who you are</strong> (profile), <strong class="text-cream">where you're headed</strong> (direction), and <strong class="text-cream">what exists</strong> (workspace). Three inputs, one output: the exact message you'd type next.
						</p>
					</div>

					<div class="grid grid-cols-3 gap-3 sm:gap-5">
						<div class="py-4 sm:py-5 text-center">
							<p class="font-display text-2xl sm:text-3xl text-moon">WHO</p>
							<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">your profile</p>
						</div>
						<div class="py-4 sm:py-5 text-center">
							<p class="font-display text-2xl sm:text-3xl text-warm">WHERE</p>
							<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">your direction</p>
						</div>
						<div class="py-4 sm:py-5 text-center">
							<p class="font-display text-2xl sm:text-3xl text-signal">WHAT</p>
							<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">your workspace</p>
						</div>
					</div>

					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-signal/70">Example prediction</p>
						<div class="mt-3 rounded-lg bg-surface-1 p-4 font-mono text-xs sm:text-sm leading-relaxed">
							<span class="text-cream-faint">&gt;</span> <span class="text-cream">add retry with exponential backoff to the executor's claude -p calls. wrap the stream consumption in a try/catch, max 3 retries. don't retry on 4xx.</span>
						</div>
						<p class="mt-3 text-[10px] sm:text-xs text-cream-faint">Generated from profile + workspace state. Not a template — a predicted message in your voice.</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════ THE ADAPTIVE LOOP ═══════════════════════ -->
	<section id="loop" class="relative px-5 sm:px-8 py-24 sm:py-40">
		<div class="mx-auto max-w-6xl">
			<div class="max-w-2xl lg:ml-auto lg:text-right">
				<p class="font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase text-moon">Adaptive, Not Batch</p>
				<h2 class="mt-4 sm:mt-5 font-display text-3xl leading-[1.1] sm:text-5xl md:text-6xl">
					Each step sees<br />
					<span class="italic text-cream-dim">what the last one did.</span>
				</h2>
			</div>

			<div class="mt-14 sm:mt-20 grid gap-16 lg:grid-cols-2 items-start">
				<!-- The loop — borderless -->
				<div class="space-y-6 sm:space-y-8">
					<div class="flex items-start gap-4 sm:gap-5">
						<div class="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-moon/10 font-mono text-sm text-moon">1</div>
						<div>
							<p class="font-display text-lg sm:text-xl text-cream">Predict</p>
							<p class="mt-1 text-sm text-cream-dim">Profile + workspace + previous results &rarr; next message</p>
						</div>
					</div>
					<div class="ml-[18px] sm:ml-5 h-6 sm:h-8 border-l border-dashed border-border"></div>
					<div class="flex items-start gap-4 sm:gap-5">
						<div class="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-signal/10 font-mono text-sm text-signal">2</div>
						<div>
							<p class="font-display text-lg sm:text-xl text-cream">Execute</p>
							<p class="mt-1 text-sm text-cream-dim">Run via <code class="font-mono text-cream-dim">claude -p</code> with <code class="font-mono text-cream-dim">--permission-mode auto</code></p>
						</div>
					</div>
					<div class="ml-[18px] sm:ml-5 h-6 sm:h-8 border-l border-dashed border-border"></div>
					<div class="flex items-start gap-4 sm:gap-5">
						<div class="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-warm/10 font-mono text-sm text-warm">3</div>
						<div>
							<p class="font-display text-lg sm:text-xl text-cream">Observe</p>
							<p class="mt-1 text-sm text-cream-dim">Read output, diff, test status, build result</p>
						</div>
					</div>
					<div class="ml-[18px] sm:ml-5 h-6 sm:h-8 border-l border-dashed border-border"></div>
					<div class="flex items-start gap-4 sm:gap-5">
						<div class="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-moon/10 font-mono text-sm text-moon">&#8634;</div>
						<div>
							<p class="font-display text-lg sm:text-xl text-cream">Adapt</p>
							<p class="mt-1 text-sm text-cream-dim">Feed results back. Tests failed? Fix them. Build broke? Course-correct. Done? Stop.</p>
						</div>
					</div>
				</div>

				<!-- Controls — borderless -->
				<div class="space-y-10">
					<!-- Run modes -->
					<div class="grid grid-cols-2 gap-6 sm:gap-8">
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Mode</p>
							<p class="mt-2 font-display text-lg sm:text-xl text-cream">Stick to plan</p>
							<p class="mt-2 text-sm text-cream-dim">One sprint. Hit the goals, then stop.</p>
						</div>
						<div>
							<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Mode</p>
							<p class="mt-2 font-display text-lg sm:text-xl text-cream">Don't stop</p>
							<p class="mt-2 text-sm text-cream-dim">After goals: docs, tests, cleanup. Runs till morning.</p>
						</div>
					</div>

					<!-- Ambition -->
					<div>
						<p class="font-mono text-[10px] tracking-[0.2em] uppercase text-cream-faint">Ambition</p>
						<div class="mt-4 flex gap-3 sm:gap-4">
							<div class="flex-1 rounded-lg bg-surface-1 py-3 sm:py-4 text-center">
								<p class="font-mono text-sm text-moon">safe</p>
								<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">Tests, docs, cleanup</p>
							</div>
							<div class="flex-1 rounded-lg bg-surface-2 py-3 sm:py-4 text-center">
								<p class="font-mono text-sm text-cream">normal</p>
								<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">Natural next steps</p>
							</div>
							<div class="flex-1 rounded-lg bg-surface-1 py-3 sm:py-4 text-center">
								<p class="font-mono text-sm text-hot">yolo</p>
								<p class="mt-1 text-[10px] sm:text-xs text-cream-faint">Bold refactors</p>
							</div>
						</div>
					</div>

					<!-- Safety -->
					<div class="rounded-lg bg-signal-dim px-5 py-4">
						<p class="text-sm text-cream">
							<strong class="text-signal">Zero risk to main.</strong> Everything on <code class="font-mono text-xs">overnight/&#123;run-id&#125;</code>. Review in the morning. Merge what you like.
						</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════ TERMINAL ═══════════════════════ -->
	<section class="px-5 sm:px-8 py-24 sm:py-40">
		<div class="mx-auto max-w-4xl">
			<div class="text-center mb-10 sm:mb-16">
				<p class="font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase text-moon">In Practice</p>
				<h2 class="mt-4 sm:mt-5 font-display text-3xl leading-[1.1] sm:text-5xl">
					A typical <span class="italic">overnight</span> run
				</h2>
			</div>

			<!-- Terminal — keep border here, it IS a window -->
			<div class="overflow-hidden rounded-xl sm:rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50">
				<div class="flex items-center gap-2 border-b border-border bg-surface-1 px-4 sm:px-5 py-3">
					<div class="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-hot/60"></div>
					<div class="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-warm/60"></div>
					<div class="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-signal/60"></div>
					<span class="ml-3 sm:ml-4 font-mono text-[10px] sm:text-[11px] text-cream-faint">overnight</span>
				</div>
				<div class="p-5 sm:p-8 font-mono text-[11px] sm:text-[13px] leading-6 sm:leading-8 overflow-x-auto">
					<p><span class="text-cream-faint">$</span> <span class="text-cream">overnight</span></p>
					<p class="mt-4 sm:mt-5 text-cream-faint">Scanning ~/.claude/projects/ ...</p>
					<p class="text-cream-faint">Built profile from <span class="text-cream">47 conversations</span> <span class="text-cream-faint">(234 turns)</span></p>
					<p class="mt-4 sm:mt-5 text-moon">Suggested plan:</p>
					<p class="text-cream ml-2">"The executor has no retry logic and the error types are</p>
					<p class="text-cream ml-2"> incomplete. You started this yesterday but got pulled away.</p>
					<p class="text-cream ml-2"> Want me to finish it tonight?"</p>
					<p class="mt-4 sm:mt-5 text-cream-faint">Ambition: <span class="text-cream">normal</span> &nbsp; Mode: <span class="text-cream">stick to plan</span> &nbsp; Max: <span class="text-cream">20 msgs</span></p>
					<p class="mt-4 sm:mt-5 text-signal">&#9656; Starting run <span class="text-cream">overnight/run-a7f3</span></p>
					<p class="mt-2 sm:mt-3"><span class="text-signal">&#10003;</span> <span class="text-cream-faint">Step 1</span> &nbsp;<span class="text-cream">Add ExecutorError type + wrap stream calls</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">Step 2</span> &nbsp;<span class="text-cream">Add exponential backoff — max 3 retries</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">Step 3</span> &nbsp;<span class="text-cream">Write executor.test.ts — 12 test cases</span></p>
					<p><span class="text-warm">&#10003;</span> <span class="text-cream-faint">Step 4</span> &nbsp;<span class="text-cream">Fix test — stream mock needed handler</span></p>
					<p><span class="text-signal">&#10003;</span> <span class="text-cream-faint">Step 5</span> &nbsp;<span class="text-cream">All 12 tests passing. Committed.</span></p>
					<p class="mt-4 sm:mt-5 text-signal">Done <span class="text-cream-faint">— 5 steps, 4m 32s, $0.18</span></p>
					<p class="text-cream-faint">Branch: <span class="text-cream">overnight/run-a7f3</span></p>
				</div>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════ CTA ═══════════════════════ -->
	<section class="relative px-5 sm:px-8 py-24 sm:py-40">
		<div class="absolute inset-0 overflow-hidden">
			<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] sm:h-[500px] sm:w-[800px] rounded-full" style="background: radial-gradient(ellipse, rgba(125,211,252,0.04) 0%, transparent 70%);"></div>
		</div>
		<div class="relative z-10 mx-auto max-w-3xl text-center">
			<h2 class="font-display text-4xl leading-[1.05] sm:text-6xl md:text-7xl">
				Ship while<br /><span class="italic text-moon">you sleep</span>
			</h2>
			<p class="mx-auto mt-5 sm:mt-6 max-w-lg text-base sm:text-lg text-cream-dim">
				Describe what you want done. Wake up to a branch full of working code, committed in your style.
			</p>
			<div class="mt-10 sm:mt-12 flex justify-center">
				<button
					onclick={copyInstall}
					class="group relative flex items-center gap-2 sm:gap-3 rounded-full border border-border bg-surface/60 px-4 sm:px-6 py-3 sm:py-3.5 font-mono text-xs sm:text-sm backdrop-blur-sm transition-all duration-300 hover:border-moon/30 hover:bg-surface-1/80"
				>
					<span class="text-cream-faint">$</span>
					<span class="text-cream">npm install -g @yail259/overnight</span>
					<span class="ml-1 text-cream-faint group-hover:text-moon transition-colors duration-300">
						{#if copied}
							<svg class="h-4 w-4 text-signal" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
						{/if}
					</span>
				</button>
			</div>
			<div class="mt-6 sm:mt-8 flex flex-col items-center gap-1.5 font-mono text-xs sm:text-sm text-cream-faint">
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight</span> <span class="text-cream-faint">&nbsp;# interactive TUI</span></p>
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight start "finish auth and add tests"</span></p>
				<p><span class="text-cream-faint">$</span> <span class="text-cream-dim">overnight log</span> <span class="text-cream-faint">&nbsp;# morning review</span></p>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-border/50">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-8 py-6 sm:py-8">
			<span class="font-display text-sm italic text-cream-faint">overnight</span>
			<div class="flex items-center gap-4 sm:gap-6">
				<a
					href="https://github.com/yail259/overnight"
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-[10px] sm:text-xs text-cream-faint hover:text-cream transition-colors duration-300"
				>GitHub</a>
				<span class="font-mono text-[10px] sm:text-xs text-cream-faint">MIT</span>
			</div>
		</div>
	</footer>
</div>
</div>
