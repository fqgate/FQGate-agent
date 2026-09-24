import type {
  CandleBar,
  CandleData,
  CandleLatest,
  CandleQuery,
  CandleService,
  KlineInterval,
  MarketRealtimeQuote,
  MarketSecurity
} from "@/shared/contracts";
import { klineIntervalLabel } from "@/shared/kline";
import { FqgateHttpClient, type FqgateHttpClientOptions } from "./FqgateHttpClient";
import {
  parseRealtimeQuote,
  type FqgateMarketDataPayload
} from "./FqgateMarketDataParsers";

type RawRecord = Record<string, unknown>;

interface FqgateKlineData {
  records?: unknown;
}

export type FqgateCandleServiceOptions = FqgateHttpClientOptions;

/**
 * 把 FQGate 的数字字段记录转换成 K 线组件使用的稳定数据结构。
 * K 线字段：1 时间、7 开、8 高、9 低、11 收、13 量、19 额、1968584 换手率；
 * 分时字段：1 时间、10 最新价、13 累计量、19 累计额。
 */
export class FqgateCandleService implements CandleService {
  readonly kind = "fqgate-local-api";

  private readonly client: FqgateHttpClient;

  constructor(options: FqgateCandleServiceOptions = {}) {
    // FQGate 行情查询的服务端预算为 30 秒，客户端略晚结束，避免在备用线路
    // 已经接管、即将返回数据时提前中断请求。
    this.client = new FqgateHttpClient({ ...options, timeoutMs: options.timeoutMs ?? 32_000 });
  }

  get connection() {
    return this.client.connection;
  }

  async getCandles(query: CandleQuery): Promise<CandleData> {
    const [records, quote] = await Promise.all([
      query.interval === "five_day"
        ? this.getFiveDayRecords(query)
        : this.getSinglePeriodData(query).then((result) => result.records),
      this.getQuoteSnapshot(query.security)
    ]);
    const bars = toBars(records, query.interval);
    if (bars.length === 0) {
      throw new Error("FQGate 未返回可显示的 K 线数据。");
    }

    const latest = mergeLatestQuote(createLatest(bars, query.interval), quote);

    return {
      security: completeSecurity(query.security),
      interval: query.interval,
      intervalLabel: klineIntervalLabel(query.interval),
      requestedCount: query.count,
      fetchedAt: new Date().toISOString(),
      latest,
      bars
    };
  }

  private async getSinglePeriodData(query: CandleQuery): Promise<FqgateKlineData> {
    return query.interval === "intraday"
      ? this.client.post<FqgateKlineData>("/v1/market/history/intraday", {
          market: query.security.market,
          code: query.security.code
        }, undefined, 30_000)
      : this.client.post<FqgateKlineData>("/v1/market/history/klines", {
          market: query.security.market,
          code: query.security.code,
          count: query.count,
          adjust: query.adjustment ?? "",
          interval: query.interval
        }, undefined, 30_000);
  }

  /**
   * K 线响应不保证包含当前价、昨收和换手率，首屏单独读取实时行情。
   * 该附加数据失败时不影响 K 线主内容，后续仍可由实时推送补齐。
   */
  private async getQuoteSnapshot(security: MarketSecurity): Promise<MarketRealtimeQuote | undefined> {
    try {
      const data = await this.client.post<FqgateMarketDataPayload>(
        "/v1/market/realtime/quote",
        {
          securities: [{ market: security.market, code: security.code }],
          fields: [5, 6, 7, 8, 9, 10, 13, 19, 1968584]
        },
        undefined,
        3_000
      );
      return parseRealtimeQuote(data);
    } catch {
      // 实时快照是附加数据，不因它暂时不可用而阻断整张图表。
    }
    return undefined;
  }

  /** 先从日 K 获取最近五个真实交易日，再并行读取对应分钟快照。 */
  private async getFiveDayRecords(query: CandleQuery): Promise<unknown> {
    const daily = await this.client.post<FqgateKlineData>("/v1/market/history/klines", {
      market: query.security.market,
      code: query.security.code,
      count: 5,
      adjust: query.adjustment ?? "",
      interval: "day"
    }, undefined, 30_000);
    const tradingDates = collectTradingDates(daily.records).slice(-5);
    if (tradingDates.length === 0) {
      throw new Error("FQGate 未返回五日走势所需的交易日。");
    }
    const snapshots = await Promise.all(tradingDates.map((date) => (
      this.client.post<FqgateKlineData>("/v1/market/history/minute-snapshot", {
        market: query.security.market,
        code: query.security.code,
        date
      }, undefined, 30_000)
    )));
    return snapshots.map((snapshot) => snapshot.records);
  }
}

function completeSecurity(security: MarketSecurity): Required<MarketSecurity> {
  return {
    market: security.market,
    code: security.code,
    name: security.name?.trim() || security.code,
    fullCode: security.fullCode?.trim() || `${security.market}${security.code}`
  };
}

/** FQGate records 为“分段 -> 记录 -> 字段”，这里只展开真正包含数字字段的记录。 */
function collectRecords(value: unknown, target: RawRecord[] = []): RawRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, target);
    return target;
  }
  if (!isRecord(value)) return target;
  if (Object.keys(value).some((key) => /^\d+$/.test(key))) target.push(value);
  return target;
}

function collectTradingDates(records: unknown): string[] {
  const dates = new Set<string>();
  for (const record of collectRecords(records)) {
    const value = String(fieldValue(record, "1") ?? "").trim();
    if (/^\d{8}$/.test(value)) dates.add(value);
  }
  return [...dates].sort();
}

function toBars(records: unknown, interval: KlineInterval): CandleBar[] {
  const byTime = new Map<number, CandleBar>();
  for (const record of collectRecords(records)) {
    const time = parseCandleTime(fieldValue(record, "1"));
    const closeField = isLineInterval(interval) ? "10" : "11";
    const close = numberValue(fieldValue(record, closeField));
    if (time === null || close === null) continue;

    const open = numberValue(fieldValue(record, "7")) ?? close;
    const sourceHigh = numberValue(fieldValue(record, "8")) ?? close;
    const sourceLow = numberValue(fieldValue(record, "9")) ?? close;
    byTime.set(time, {
      time,
      label: formatCandleLabel(time, interval),
      open,
      high: Math.max(sourceHigh, open, close),
      low: Math.min(sourceLow, open, close),
      close,
      volume: numberValue(fieldValue(record, "13")) ?? 0,
      amount: numberValue(fieldValue(record, "19")) ?? 0,
      turnoverRate: numberValue(fieldValue(record, "1968584"))
    });
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function createLatest(bars: CandleBar[], interval: KlineInterval): CandleLatest {
  const latest = bars.at(-1)!;
  if (isLineInterval(interval)) {
    const latestDay = localDateKey(latest.time);
    const latestDayBars = bars.filter((bar) => localDateKey(bar.time) === latestDay);
    const previousDayClose = [...bars]
      .reverse()
      .find((bar) => localDateKey(bar.time) !== latestDay)?.close;
    const change = previousDayClose === undefined ? null : latest.close - previousDayClose;
    return {
      ...latest,
      open: latestDayBars[0]?.close ?? latest.close,
      high: Math.max(...latestDayBars.map((bar) => bar.close)),
      low: Math.min(...latestDayBars.map((bar) => bar.close)),
      change,
      changePercent: change !== null && previousDayClose ? change / previousDayClose * 100 : null
    };
  }

  const previous = bars.at(-2);
  const change = previous ? latest.close - previous.close : null;
  const changePercent = previous && previous.close !== 0 ? change! / previous.close * 100 : null;
  return { ...latest, change, changePercent };
}

/** 使用同一时点的实时价和昨收计算涨跌，避免分时数据缺少上一交易日时显示为空。 */
function mergeLatestQuote(
  latest: CandleLatest,
  quote: MarketRealtimeQuote | undefined
): CandleLatest {
  if (!quote) return latest;
  const close = quote.latestPrice ?? latest.close;
  const previousClose = quote.previousClose;
  const change = previousClose === null ? latest.change : close - previousClose;
  const changePercent = previousClose === null || previousClose === 0
    ? latest.changePercent
    : change! / previousClose * 100;
  return {
    ...latest,
    open: quote.open ?? latest.open,
    high: quote.high ?? Math.max(latest.high, close),
    low: quote.low ?? Math.min(latest.low, close),
    close,
    volume: quote.volume ?? latest.volume,
    amount: quote.amount ?? latest.amount,
    turnoverRate: quote.turnoverRate ?? latest.turnoverRate,
    change,
    changePercent
  };
}

function fieldValue(record: RawRecord, field: string): unknown {
  const raw = record[field];
  if (isRecord(raw) && "value" in raw) return raw.value;
  return raw;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** 同时兼容 Unix 秒、毫秒和接口可能返回的紧凑日期/日期时间。 */
function parseCandleTime(value: unknown): number | null {
  const compact = String(value ?? "").trim().replaceAll(/[-/: T]/g, "");
  if (/^\d{8}$/.test(compact)) {
    return chinaLocalPartsToUnix(compact, false);
  }
  if (/^\d{12}(\d{2})?$/.test(compact)) {
    return chinaLocalPartsToUnix(compact, true);
  }

  const numeric = numberValue(value);
  if (numeric !== null) {
    const packedTime = packedMarketTimeToUnix(numeric);
    if (packedTime !== null) return packedTime;
    if (numeric > 10_000_000_000) return Math.floor(numeric / 1000);
    if (numeric > 100_000_000) return Math.floor(numeric);
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

/**
 * 分钟 K 的字段 1 使用行情协议位布局：年从 1900 起，占高 12 位，随后是
 * 月、日、时、分。先严格校验每一部分，再把它当作北京时间转换。
 */
function packedMarketTimeToUnix(value: number): number | null {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) return null;
  const packed = value >>> 0;
  const year = (packed >>> 20) + 1900;
  const month = (packed >>> 16) & 0x0f;
  const day = (packed >>> 11) & 0x1f;
  const hour = (packed >>> 6) & 0x1f;
  const minute = packed & 0x3f;
  if (
    year < 1990
    || year > 2200
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour > 23
    || minute > 59
  ) return null;
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute) / 1000);
}

function chinaLocalPartsToUnix(value: string, withTime: boolean): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = withTime ? Number(value.slice(8, 10)) : 12;
  const minute = withTime ? Number(value.slice(10, 12)) : 0;
  const second = withTime && value.length === 14 ? Number(value.slice(12, 14)) : 0;
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute, second) / 1000);
}

function formatCandleLabel(time: number, interval: KlineInterval): string {
  const withTime = isLineInterval(interval) || interval.endsWith("m");
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).format(new Date(time * 1000));
}

function isLineInterval(interval: KlineInterval): boolean {
  return interval === "intraday" || interval === "five_day";
}

function localDateKey(time: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(time * 1000));
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
