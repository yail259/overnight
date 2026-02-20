<script lang="ts">
  import "../app.css";
  let { children } = $props();

  const navItems = [
    { href: "/", label: "Dashboard", icon: "◉" },
    { href: "/chat", label: "Chat", icon: "◈" },
  ];
</script>

<div class="flex h-screen">
  <nav class="w-56 bg-surface-1 border-r border-border flex flex-col shrink-0">
    <div class="p-4 border-b border-border">
      <h1 class="text-lg font-bold text-accent">overnight</h1>
      <p class="text-xs text-text-dim mt-0.5">portfolio agent</p>
    </div>

    <div class="flex-1 p-2">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-surface-2 transition-colors text-text-dim hover:text-text"
        >
          <span class="text-base">{item.icon}</span>
          {item.label}
        </a>
      {/each}
    </div>

    <div class="p-4 border-t border-border">
      <p class="text-xs text-text-dim">Paper Trading</p>
    </div>
  </nav>

  <main class="flex-1 overflow-auto">
    {@render children()}
  </main>
</div>
