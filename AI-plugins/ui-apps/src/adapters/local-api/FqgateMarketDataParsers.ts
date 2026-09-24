import type {
  MarketDepthLevel,
  MarketDepthSide,
  MarketRealtimePoint,
  MarketRealtimeQuote,
  MarketTransaction
} from "@/shared/contracts";

export type JsonObject = Record<string, unknown>;

export interface FqgateMarketDataPayload {
  records?: unknown;
  semantic_records?: unknown;
  depth?: Array<{
    security?: string | null;
    bids?: FqgateDepthLevel[];
    asks?: FqgateDepthLevel[];
  }>;
}

interface FqgateDepthLevel {
  level?: number;
  price?: number | null;
  volume?: number | null;
}

const BASIC_BID_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["24", "25"], ["26", "27"], ["28", "29"], ["150", "151"], ["154", "155"]
];
const BASIC_ASK_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["30", "31"], ["32", "33"], ["34", "35"], ["152", "153"], ["156", "157"]
];

export const MARKET_TRANSACTION_LIMIT = 500;

export function parseLevel2Depth(data: FqgateMarketDataPayload): {
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
} {
  const snapshot = data.depth?.[0];
  return {
    bids: normalizeDepthLevels(snapshot?.bids),
    asks: normalizeDepthLevels(snapshot?.asks)
  };
}

export function parseBasicDepth(data: FqgateMarketDataPayload): {
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
} {
  const record = firstRawRecord(data.records);
  return {
    bids: parseRawDepth(record, BASIC_BID_FIELDS),
    asks: parseRawDepth(record, BASIC_ASK_FIELDS)
  };
}

export function parseBasicTransactions(data: FqgateMarketDataPayload): MarketTransaction[] {
  return flattenRawRecords(data.records)
    .map((record, index) => {
      const timestamp = strictTimestamp(fieldNumber(record, "1"));
      const price = fieldNumber(record, "10");
      const volume = fieldNumber(record, "49");
      return {
        id: ["basic", timestamp, price, volume, index].join(":"),
        timestamp,
        price,
        volume,
        side: basicTransactionSide(fieldNumber(record, "12"))
      } satisfies MarketTransaction;
    })
    .filter(hasTransactionValue)
    .sort(sortTransactionsNewestFirst)
    .slice(0, MARKET_TRANSACTION_LIMIT);
}

export function parseLevel2Transactions(data: FqgateMarketDataPayload): MarketTransaction[] {
  const batches = Array.isArray(data.semantic_records) ? data.semantic_records : [];
  const result: MarketTransaction[] = [];
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const item of batch) {
      const semantic = asObject(item);
      const values = asObject(semantic?.values);
      const derived = asObject(semantic?.derived);
      if (!values) continue;
      const timestamp = derivedTimestamp(derived)
        ?? strictTimestamp(fieldValueNumber(values.trade_time));
      const price = fieldValueNumber(values.price);
      const volume = fieldValueNumber(values.volume);
      const sourceId = fieldValue(values.source_tick_id);
      result.push({
        id: ["level2", sourceId, timestamp, price, volume].join(":"),
        timestamp,
        price,
        volume,
        side: semanticSide(derived?.side)
      });
    }
  }
  return result
    .filter(hasTransactionValue)
    .sort(sortTransactionsNewestFirst)
    .slice(0, MARKET_TRANSACTION_LIMIT);
}

export function parseRealtimeQuote(data: FqgateMarketDataPayload): MarketRealtimeQuote | undefined {
  const record = firstRawRecord(data.records);
  if (!record) return undefined;
  const latestPrice = fieldNumber(record, "10");
  const volume = fieldNumber(record, "13");
  const amount = fieldNumber(record, "19");
  if (latestPrice === null && volume === null && amount === null) return undefined;
  return {
    updatedAt: Date.now(),
    latestPrice,
    previousClose: fieldNumber(record, "6"),
    open: fieldNumber(record, "7"),
    high: fieldNumber(record, "8"),
    low: fieldNumber(record, "9"),
    volume,
    amount,
    turnoverRate: fieldNumber(record, "1968584")
  };
}

export function parseRealtimePoints(data: FqgateMarketDataPayload): MarketRealtimePoint[] {
  return flattenRawRecords(data.records).flatMap((record) => {
    const timestamp = strictTimestamp(fieldNumber(record, "1"));
    const price = fieldNumber(record, "10");
    if (timestamp === null || price === null) return [];
    return [{
      timestamp,
      price,
      volume: fieldNumber(record, "13"),
      amount: fieldNumber(record, "19")
    }];
  }).sort((left, right) => left.timestamp - right.timestamp);
}

function normalizeDepthLevels(levels: FqgateDepthLevel[] | undefined): MarketDepthLevel[] {
  const byLevel = new Map(
    (levels ?? [])
      .filter((item) => Number.isInteger(item.level) && item.level! >= 1 && item.level! <= 10)
      .map((item) => [item.level!, item])
  );
  return Array.from({ length: 10 }, (_, index) => {
    const level = index + 1;
    const item = byLevel.get(level);
    return {
      level,
      price: finiteNumber(item?.price),
      volume: finiteNumber(item?.volume)
    };
  });
}

function parseRawDepth(
  record: JsonObject | undefined,
  fields: ReadonlyArray<readonly [string, string]>
): MarketDepthLevel[] {
  return fields.map(([priceField, volumeField], index) => ({
    level: index + 1,
    price: record ? fieldNumber(record, priceField) : null,
    volume: record ? fieldNumber(record, volumeField) : null
  }));
}

function flattenRawRecords(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const result: JsonObject[] = [];
  for (const batch of value) {
    if (!Array.isArray(batch)) continue;
    for (const record of batch) {
      const object = asObject(record);
      if (object) result.push(object);
    }
  }
  return result;
}

function firstRawRecord(value: unknown): JsonObject | undefined {
  return flattenRawRecords(value)[0];
}

function fieldNumber(record: JsonObject, fieldId: string): number | null {
  return fieldValueNumber(record[fieldId]);
}

function fieldValueNumber(value: unknown): number | null {
  return finiteNumber(fieldValue(value));
}

function fieldValue(value: unknown): unknown {
  const object = asObject(value);
  return object && "value" in object ? object.value : value;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function strictTimestamp(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 1_000_000_000_000) return value;
  if (value >= 1_000_000_000) return value * 1_000;
  return null;
}

function derivedTimestamp(derived: JsonObject | undefined): number | null {
  const timestamp = asObject(derived?.timestamp);
  return strictTimestamp(finiteNumber(timestamp?.unix_milliseconds));
}

function basicTransactionSide(value: number | null): MarketDepthSide {
  if (value === 5) return "buy";
  if (value === 1) return "sell";
  return "unknown";
}

function semanticSide(value: unknown): MarketDepthSide {
  return value === "buy" || value === "sell" ? value : "unknown";
}

function hasTransactionValue(item: MarketTransaction): boolean {
  return item.timestamp !== null || item.price !== null || item.volume !== null;
}

function sortTransactionsNewestFirst(left: MarketTransaction, right: MarketTransaction): number {
  return (right.timestamp ?? 0) - (left.timestamp ?? 0);
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
