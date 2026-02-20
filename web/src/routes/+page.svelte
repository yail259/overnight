<script lang="ts">
  import Chart from "$lib/components/Chart.svelte";

  let { data } = $props();

  function fmt(n: number | null | undefined, decimals = 2): string {
    if (n == null) return "\u2014";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function fmtUsd(n: number | null | undefined): string {
    if (n == null) return "\u2014";
    return "$" + fmt(n);
  }

  function fmtPct(n: number | null | undefined): string {
    if (n == null) return "\u2014";
    return (n * 100).toFixed(2) + "%";
  }

  function plColor(n: number | null | undefined): string {
    if (n == null) return "text-text-dim";
    return n >= 0 ? "text-green" : "text-red";
  }

  function timeAgo(ts: string | undefined): string {
    if (!ts) return "never";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const dailyPl = $derived(data.account
    ? data.account.equity - data.account.last_equity
    : null);
  const dailyPlPct = $derived(data.account?.last_equity
    ? dailyPl! / data.account.last_equity
    : null);
</script>

<svelte:head>
  <title>Dashboard | overnight</title>
</svelte:head>

<div class="p-6 space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-xl font-bold">Portfolio Dashboard</h2>
      <p class="text-xs text-text-dim mt-1">
        {#if data.clock}
          Market {data.clock.is_open ? "OPEN" : "CLOSED"}
        {/if}
        {#if data.agentState}
          &middot; Loop #{data.agentState.loop_count} &middot; Last run {timeAgo(data.agentState.last_run_at)}
        {/if}
      </p>
    </div>

    {#if data.agentState?.halted}
      <span class="px-3 py-1 text-xs bg-red/20 text-red rounded-full">
        HALTED: {data.agentState.halt_reason}
      </span>
    {:else if data.agentState}
      <span class="px-3 py-1 text-xs bg-green/20 text-green rounded-full">RUNNING</span>
    {:else}
      <span class="px-3 py-1 text-xs bg-surface-3 text-text-dim rounded-full">NOT RUNNING</span>
    {/if}
  </div>

  <!-- Account cards -->
  {#if data.account}
    <div class="grid grid-cols-4 gap-4">
      <div class="bg-surface-1 border border-border rounded-lg p-4">
        <p class="text-xs text-text-dim mb-1">Equity</p>
        <p class="text-xl font-bold">{fmtUsd(data.account.equity)}</p>
      </div>
      <div class="bg-surface-1 border border-border rounded-lg p-4">
        <p class="text-xs text-text-dim mb-1">Daily P&L</p>
        <p class="text-xl font-bold {plColor(dailyPl)}">
          {dailyPl != null && dailyPl >= 0 ? "+" : ""}{fmtUsd(dailyPl)}
          <span class="text-sm font-normal">({dailyPlPct != null && dailyPlPct >= 0 ? "+" : ""}{fmtPct(dailyPlPct)})</span>
        </p>
      </div>
      <div class="bg-surface-1 border border-border rounded-lg p-4">
        <p class="text-xs text-text-dim mb-1">Cash</p>
        <p class="text-xl font-bold">{fmtUsd(data.account.cash)}</p>
      </div>
      <div class="bg-surface-1 border border-border rounded-lg p-4">
        <p class="text-xs text-text-dim mb-1">Buying Power</p>
        <p class="text-xl font-bold">{fmtUsd(data.account.buying_power)}</p>
      </div>
    </div>
  {:else}
    <div class="bg-surface-1 border border-border rounded-lg p-8 text-center text-text-dim">
      <p class="text-lg mb-2">No Alpaca connection</p>
      <p class="text-xs">Set ALPACA_KEY_ID and ALPACA_SECRET_KEY env vars</p>
    </div>
  {/if}

  <!-- Chart + Positions -->
  <div class="grid grid-cols-3 gap-4">
    <div class="col-span-2 bg-surface-1 border border-border rounded-lg p-4">
      <p class="text-xs text-text-dim mb-3">Portfolio Value &mdash; 1 Month</p>
      {#if data.history && data.history.equity.length > 0}
        <div class="h-64">
          <Chart timestamps={data.history.timestamps} values={data.history.equity} />
        </div>
      {:else}
        <div class="h-64 flex items-center justify-center text-text-dim text-sm">No history data</div>
      {/if}
    </div>

    <div class="bg-surface-1 border border-border rounded-lg p-4">
      <p class="text-xs text-text-dim mb-3">Positions ({data.positions.length})</p>
      {#if data.positions.length > 0}
        <div class="space-y-2 max-h-64 overflow-auto">
          {#each data.positions as pos}
            <div class="flex justify-between items-center text-sm py-1 border-b border-border/50 last:border-0">
              <div>
                <span class="font-bold">{pos.symbol}</span>
                <span class="text-text-dim ml-1">{pos.qty}</span>
              </div>
              <div class="text-right">
                <div>{fmtUsd(pos.market_value)}</div>
                <div class="text-xs {plColor(pos.unrealized_pl)}">
                  {pos.unrealized_pl >= 0 ? "+" : ""}{fmtUsd(pos.unrealized_pl)}
                  ({fmtPct(pos.unrealized_plpc)})
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-text-dim text-sm">No open positions</p>
      {/if}
    </div>
  </div>

  <!-- Decisions + Orders -->
  <div class="grid grid-cols-3 gap-4">
    <div class="col-span-2 bg-surface-1 border border-border rounded-lg p-4">
      <p class="text-xs text-text-dim mb-3">Agent Decisions</p>
      {#if data.decisions.length > 0}
        <div class="space-y-3 max-h-80 overflow-auto">
          {#each data.decisions as d}
            <div class="border-b border-border/50 pb-3 last:border-0">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs px-2 py-0.5 rounded-full
                  {d.action === 'hold' ? 'bg-yellow/10 text-yellow' :
                   d.action === 'buy' ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}">
                  {d.action.toUpperCase()}
                  {#if d.symbol} {d.symbol}{/if}
                  {#if d.qty} x{d.qty}{/if}
                </span>
                <span class="text-xs text-text-dim">
                  Loop #{d.loop} &middot; {new Date(d.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p class="text-xs text-text-dim leading-relaxed">
                {d.reasoning.slice(0, 200)}{d.reasoning.length > 200 ? "..." : ""}
              </p>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-text-dim text-sm">No decisions yet. Start the agent to see activity.</p>
      {/if}
    </div>

    <div class="bg-surface-1 border border-border rounded-lg p-4">
      <p class="text-xs text-text-dim mb-3">Recent Orders</p>
      {#if data.orders.length > 0}
        <div class="space-y-2 max-h-80 overflow-auto">
          {#each data.orders as order}
            <div class="text-xs border-b border-border/50 pb-2 last:border-0">
              <div class="flex justify-between">
                <span class="font-bold">
                  <span class={order.side === "buy" ? "text-green" : "text-red"}>
                    {order.side.toUpperCase()}
                  </span>
                  {order.symbol}
                </span>
                <span class="text-text-dim">{order.qty}</span>
              </div>
              <div class="flex justify-between text-text-dim mt-0.5">
                <span>{order.type} &middot; {order.status}</span>
                {#if order.filled_avg_price}
                  <span>{fmtUsd(order.filled_avg_price)}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-text-dim text-sm">No recent orders</p>
      {/if}
    </div>
  </div>
</div>
