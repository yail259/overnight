import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { z } from "zod";
import type { AgentConfig } from "../types.js";

export function createAlpacaMcpServer(config: AgentConfig) {
  const alpaca = new Alpaca({
    keyId: config.alpaca_key_id ?? process.env.ALPACA_KEY_ID,
    secretKey: config.alpaca_secret_key ?? process.env.ALPACA_SECRET_KEY,
    paper: config.paper_trading,
  });

  return createSdkMcpServer({
    name: "alpaca",
    version: "1.0.0",
    tools: [

      tool(
        "get_account",
        "Get account info: equity, cash, buying_power, portfolio_value, today P&L",
        {},
        async () => {
          const acct = await alpaca.getAccount();
          return { content: [{ type: "text" as const, text: JSON.stringify({
            equity: acct.equity,
            cash: acct.cash,
            buying_power: acct.buying_power,
            portfolio_value: acct.portfolio_value,
            daytrade_count: acct.daytrade_count,
          }, null, 2) }] };
        }
      ),

      tool(
        "get_positions",
        "Get all open positions with unrealized P&L",
        {},
        async () => {
          const positions = await alpaca.getPositions();
          return { content: [{ type: "text" as const, text: JSON.stringify(
            positions.map((p: any) => ({
              symbol: p.symbol,
              qty: p.qty,
              market_value: p.market_value,
              unrealized_pl: p.unrealized_pl,
              unrealized_plpc: p.unrealized_plpc,
              avg_entry_price: p.avg_entry_price,
              current_price: p.current_price,
              side: p.side,
            })), null, 2
          ) }] };
        }
      ),

      tool(
        "get_market_clock",
        "Check if market is open and next open/close times",
        {},
        async () => {
          const clock = await alpaca.getClock();
          return { content: [{ type: "text" as const, text: JSON.stringify({
            is_open: clock.is_open,
            next_open: clock.next_open,
            next_close: clock.next_close,
            timestamp: clock.timestamp,
          }, null, 2) }] };
        }
      ),

      tool(
        "get_bars",
        "Get OHLCV price bars for a symbol. Use timeframe like '1Min', '5Min', '15Min', '1Hour', '1Day'",
        {
          symbol: z.string().describe("Ticker symbol e.g. AAPL"),
          timeframe: z.string().describe("Bar timeframe: 1Min, 5Min, 15Min, 1Hour, 1Day"),
          limit: z.number().int().min(1).max(200).optional().describe("Number of bars (default 50)"),
        },
        async (args) => {
          const bars: any[] = [];
          const iter = alpaca.getBarsV2(args.symbol, {
            timeframe: args.timeframe,
            limit: args.limit ?? 50,
          });
          for await (const bar of iter) {
            bars.push({
              t: bar.Timestamp,
              o: bar.OpenPrice,
              h: bar.HighPrice,
              l: bar.LowPrice,
              c: bar.ClosePrice,
              v: bar.Volume,
              vwap: bar.VWAP,
            });
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(bars, null, 2) }] };
        }
      ),

      tool(
        "get_latest_quote",
        "Get latest bid/ask quote for a symbol",
        {
          symbol: z.string().describe("Ticker symbol"),
        },
        async (args) => {
          const quote = await alpaca.getLatestQuote(args.symbol);
          return { content: [{ type: "text" as const, text: JSON.stringify({
            symbol: args.symbol,
            bid_price: quote.BidPrice,
            ask_price: quote.AskPrice,
            bid_size: quote.BidSize,
            ask_size: quote.AskSize,
            timestamp: quote.Timestamp,
          }, null, 2) }] };
        }
      ),

      tool(
        "get_orders",
        "Get recent orders. Filter by status: open, closed, or all",
        {
          status: z.enum(["open", "closed", "all"]).optional().describe("Order status filter (default: all)"),
          limit: z.number().int().min(1).max(100).optional().describe("Max orders to return (default: 20)"),
        },
        async (args) => {
          const orders = await alpaca.getOrders({
            status: args.status ?? "all",
            limit: args.limit ?? 20,
            direction: undefined, until: undefined, after: undefined, nested: undefined, symbols: undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(
            orders.map((o: any) => ({
              id: o.id,
              symbol: o.symbol,
              side: o.side,
              type: o.type,
              qty: o.qty,
              filled_qty: o.filled_qty,
              filled_avg_price: o.filled_avg_price,
              status: o.status,
              submitted_at: o.submitted_at,
              filled_at: o.filled_at,
            })), null, 2
          ) }] };
        }
      ),

      tool(
        "place_order",
        "Place a market or limit order. Guardrails are enforced automatically — symbol allowlist, daily loss cap, and position limits are checked before execution.",
        {
          symbol: z.string().describe("Ticker symbol"),
          side: z.enum(["buy", "sell"]).describe("Order side"),
          qty: z.number().positive().describe("Number of shares"),
          order_type: z.enum(["market", "limit"]).optional().describe("Order type (default: market)"),
          limit_price: z.number().positive().optional().describe("Limit price (required for limit orders)"),
          time_in_force: z.enum(["day", "gtc", "ioc"]).optional().describe("Time in force (default: day)"),
        },
        async (args) => {
          const order = await alpaca.createOrder({
            symbol: args.symbol,
            qty: args.qty,
            side: args.side,
            type: args.order_type ?? "market",
            time_in_force: args.time_in_force ?? "day",
            ...(args.limit_price && { limit_price: String(args.limit_price) }),
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({
            order_id: order.id,
            symbol: order.symbol,
            side: order.side,
            qty: order.qty,
            type: order.type,
            status: order.status,
            submitted_at: order.submitted_at,
          }, null, 2) }] };
        }
      ),

      tool(
        "cancel_order",
        "Cancel an open order by ID",
        {
          order_id: z.string().describe("Order ID to cancel"),
        },
        async (args) => {
          await alpaca.cancelOrder(args.order_id);
          return { content: [{ type: "text" as const, text: `Order ${args.order_id} cancelled.` }] };
        }
      ),

      tool(
        "close_position",
        "Close entire position for a symbol (sells all shares)",
        {
          symbol: z.string().describe("Ticker symbol"),
        },
        async (args) => {
          const result = await alpaca.closePosition(args.symbol);
          return { content: [{ type: "text" as const, text: JSON.stringify({
            symbol: args.symbol,
            order_id: result.id,
            status: result.status,
          }, null, 2) }] };
        }
      ),

      tool(
        "log_reasoning",
        "Log your reasoning and decision for this loop iteration. Call this BEFORE placing any order or deciding to hold.",
        {
          action: z.enum(["buy", "sell", "hold"]).describe("Planned action"),
          symbol: z.string().optional().describe("Symbol (if buy/sell)"),
          qty: z.number().optional().describe("Quantity (if buy/sell)"),
          reasoning: z.string().describe("Detailed reasoning for this decision"),
          market_context: z.string().describe("Key market observations"),
          portfolio_summary: z.string().describe("Current portfolio state"),
          guardrail_note: z.string().optional().describe("Any guardrail constraints applied"),
        },
        async (args) => {
          return { content: [{ type: "text" as const, text: `Decision logged: ${args.action} ${args.symbol ?? ""} — ${args.reasoning.slice(0, 120)}` }] };
        }
      ),
    ],
  });
}
