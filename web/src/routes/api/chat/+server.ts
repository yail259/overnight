import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { z } from "zod";
import { env } from "$env/dynamic/private";

function createChatMcpServer() {
  const alpaca = new Alpaca({
    keyId: env.ALPACA_KEY_ID,
    secretKey: env.ALPACA_SECRET_KEY,
    paper: true,
  });

  return createSdkMcpServer({
    name: "alpaca",
    version: "1.0.0",
    tools: [
      tool("get_account", "Get account info", {}, async () => {
        const a = await alpaca.getAccount();
        return { content: [{ type: "text" as const, text: JSON.stringify({
          equity: a.equity, cash: a.cash, buying_power: a.buying_power,
          portfolio_value: a.portfolio_value,
        }, null, 2) }] };
      }),
      tool("get_positions", "Get open positions", {}, async () => {
        const p = await alpaca.getPositions();
        return { content: [{ type: "text" as const, text: JSON.stringify(
          p.map((x: any) => ({
            symbol: x.symbol, qty: x.qty, market_value: x.market_value,
            unrealized_pl: x.unrealized_pl, current_price: x.current_price,
          })), null, 2
        ) }] };
      }),
      tool("get_bars", "Get price bars", {
        symbol: z.string(), timeframe: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      }, async (args) => {
        const bars: any[] = [];
        for await (const b of alpaca.getBarsV2(args.symbol, {
          timeframe: args.timeframe, limit: args.limit ?? 50,
        })) {
          bars.push({ t: b.Timestamp, o: b.OpenPrice, h: b.HighPrice,
            l: b.LowPrice, c: b.ClosePrice, v: b.Volume });
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(bars, null, 2) }] };
      }),
      tool("get_latest_quote", "Get latest quote", {
        symbol: z.string(),
      }, async (args) => {
        const q = await alpaca.getLatestQuote(args.symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          symbol: args.symbol, bid: q.BidPrice, ask: q.AskPrice,
        }, null, 2) }] };
      }),
      tool("get_orders", "Get recent orders", {
        status: z.enum(["open", "closed", "all"]).optional(),
      }, async (args) => {
        const orders = await alpaca.getOrders({
          status: args.status ?? "all", limit: 10,
          direction: undefined, until: undefined, after: undefined,
          nested: undefined, symbols: undefined,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(
          orders.map((o: any) => ({
            symbol: o.symbol, side: o.side, qty: o.qty, status: o.status,
            filled_avg_price: o.filled_avg_price,
          })), null, 2
        ) }] };
      }),
      tool("get_market_clock", "Check market hours", {}, async () => {
        const c = await alpaca.getClock();
        return { content: [{ type: "text" as const, text: JSON.stringify({
          is_open: c.is_open, next_open: c.next_open, next_close: c.next_close,
        }, null, 2) }] };
      }),
    ],
  });
}

const CHAT_SYSTEM_PROMPT = `You are a helpful portfolio assistant. You have access to the user's Alpaca paper trading account via tools.

Use the tools to look up real data before answering questions about the portfolio, positions, or markets.
Be concise and use numbers/data to back up your responses.
Format currency values with $ and 2 decimal places.
Do NOT place orders or modify the portfolio unless the user explicitly asks.`;

const MCP_TOOLS = [
  "mcp__alpaca__get_account",
  "mcp__alpaca__get_positions",
  "mcp__alpaca__get_bars",
  "mcp__alpaca__get_latest_quote",
  "mcp__alpaca__get_orders",
  "mcp__alpaca__get_market_clock",
];

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, session_id } = body as { message: string; session_id?: string };

  if (!message) return error(400, "message required");
  if (!env.ALPACA_KEY_ID) return error(500, "ALPACA_KEY_ID not configured");

  const mcpServer = createChatMcpServer();

  const options: Record<string, any> = {
    systemPrompt: CHAT_SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    maxTurns: 15,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers: { alpaca: mcpServer },
    tools: [],
    allowedTools: MCP_TOOLS,
    ...(session_id && { resume: session_id }),
  };

  let resultText = "";
  let resultSessionId: string | undefined;

  try {
    const conversation = query({ prompt: message, options });

    for await (const msg of conversation) {
      if (msg.type === "result") {
        resultSessionId = msg.session_id;
        if (msg.subtype === "success") {
          resultText = msg.result;
        } else {
          const errResult = msg as unknown as { errors?: string[] };
          resultText = `Error: ${errResult.errors?.join(", ") ?? "unknown"}`;
        }
      } else if (msg.type === "system" && "subtype" in msg && msg.subtype === "init") {
        resultSessionId = msg.session_id;
      }
    }
  } catch (e) {
    return error(500, (e as Error).message);
  }

  return json({
    result: resultText,
    session_id: resultSessionId,
  });
};
