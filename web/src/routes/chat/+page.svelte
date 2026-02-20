<script lang="ts">
  interface Message {
    role: "user" | "assistant";
    content: string;
  }

  let messages = $state<Message[]>([]);
  let input = $state("");
  let loading = $state(false);
  let sessionId = $state<string | null>(null);
  let messagesDiv: HTMLDivElement;

  function scrollToBottom() {
    if (messagesDiv) {
      requestAnimationFrame(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      });
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    messages.push({ role: "user", content: text });
    input = "";
    loading = true;
    scrollToBottom();

    // Add placeholder assistant message
    const assistantIdx = messages.length;
    messages.push({ role: "assistant", content: "" });

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        messages[assistantIdx].content = `Error: ${err}`;
        loading = false;
        return;
      }

      const data = await resp.json();
      messages[assistantIdx].content = data.result || "No response.";
      if (data.session_id) sessionId = data.session_id;
    } catch (e) {
      messages[assistantIdx].content = `Error: ${(e as Error).message}`;
    }

    loading = false;
    scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

<svelte:head>
  <title>Chat | overnight</title>
</svelte:head>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="p-4 border-b border-border">
    <h2 class="text-lg font-bold">Portfolio Chat</h2>
    <p class="text-xs text-text-dim mt-0.5">
      Talk to the agent. It has access to your Alpaca account, positions, and market data.
    </p>
  </div>

  <!-- Messages -->
  <div bind:this={messagesDiv} class="flex-1 overflow-auto p-4 space-y-4">
    {#if messages.length === 0}
      <div class="flex items-center justify-center h-full text-text-dim text-sm">
        <div class="text-center space-y-2">
          <p>Ask about your portfolio, market conditions, or trading ideas.</p>
          <div class="flex flex-wrap gap-2 justify-center mt-4">
            {#each [
              "How is my portfolio doing today?",
              "What are my current positions?",
              "Should I rebalance?",
              "What's the market sentiment on NVDA?"
            ] as suggestion}
              <button
                onclick={() => { input = suggestion; sendMessage(); }}
                class="text-xs px-3 py-1.5 bg-surface-2 border border-border rounded-full hover:bg-surface-3 transition-colors cursor-pointer"
              >
                {suggestion}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[75%] text-sm {msg.role === 'user' ? 'bg-accent/20 text-text' : 'bg-surface-2 text-text'} rounded-lg px-4 py-3">
          {#if msg.content}
            <pre class="whitespace-pre-wrap font-[inherit] m-0">{msg.content}</pre>
          {:else if loading}
            <span class="text-text-dim animate-pulse">Thinking...</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Input -->
  <div class="p-4 border-t border-border">
    <div class="flex gap-2">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Ask about your portfolio..."
        rows={1}
        class="flex-1 bg-surface-2 border border-border rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:border-accent transition-colors placeholder:text-text-dim"
        disabled={loading}
      ></textarea>
      <button
        onclick={sendMessage}
        disabled={loading || !input.trim()}
        class="px-4 py-3 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        Send
      </button>
    </div>
  </div>
</div>
