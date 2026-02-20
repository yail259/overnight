import Alpaca from "@alpacahq/alpaca-trade-api";
import { env } from "$env/dynamic/private";

let _client: InstanceType<typeof Alpaca> | null = null;

export function getAlpacaClient() {
  if (!_client) {
    _client = new Alpaca({
      keyId: env.ALPACA_KEY_ID,
      secretKey: env.ALPACA_SECRET_KEY,
      paper: true,
    });
  }
  return _client;
}

export async function getAccount() {
  const client = getAlpacaClient();
  const acct = await client.getAccount();
  return {
    equity: Number(acct.equity),
    cash: Number(acct.cash),
    buying_power: Number(acct.buying_power),
    portfolio_value: Number(acct.portfolio_value),
    daytrade_count: Number(acct.daytrade_count),
    last_equity: Number(acct.last_equity),
  };
}

export async function getPositions() {
  const client = getAlpacaClient();
  const positions = await client.getPositions();
  return positions.map((p: any) => ({
    symbol: p.symbol as string,
    qty: Number(p.qty),
    market_value: Number(p.market_value),
    unrealized_pl: Number(p.unrealized_pl),
    unrealized_plpc: Number(p.unrealized_plpc),
    avg_entry_price: Number(p.avg_entry_price),
    current_price: Number(p.current_price),
    side: p.side as string,
    change_today: Number(p.change_today),
  }));
}

export async function getOrders(status: string = "all", limit: number = 20) {
  const client = getAlpacaClient();
  const orders = await client.getOrders({
    status,
    limit,
    direction: undefined,
    until: undefined,
    after: undefined,
    nested: undefined,
    symbols: undefined,
  });
  return orders.map((o: any) => ({
    id: o.id as string,
    symbol: o.symbol as string,
    side: o.side as string,
    type: o.type as string,
    qty: Number(o.qty),
    filled_qty: Number(o.filled_qty),
    filled_avg_price: o.filled_avg_price ? Number(o.filled_avg_price) : null,
    status: o.status as string,
    submitted_at: o.submitted_at as string,
    filled_at: o.filled_at as string | null,
  }));
}

export async function getPortfolioHistory(period: string = "1W") {
  const client = getAlpacaClient();
  const history = await client.getPortfolioHistory({
    period,
    timeframe: "1D",
  });
  return {
    timestamps: history.timestamp as number[],
    equity: history.equity as number[],
    profit_loss: history.profit_loss as number[],
    profit_loss_pct: history.profit_loss_pct as number[],
  };
}

export async function getMarketClock() {
  const client = getAlpacaClient();
  const clock = await client.getClock();
  return {
    is_open: clock.is_open as boolean,
    next_open: clock.next_open as string,
    next_close: clock.next_close as string,
  };
}
