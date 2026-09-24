import type {
  OrderFlowQuote,
  OrderFlowRecord,
  OrderFlowRecordKind,
  OrderFlowSide
} from "@/shared/contracts";
import type { FqgateStandardQuoteData } from "./FqgateMarketDataParsers";

type JsonObject = Record<string, unknown>;
export type OrderFlowDetailKind = "order_detail" | "buy_cancel" | "sell_cancel";

export function parseStandardOrderFlowQuote(
  data: FqgateStandardQuoteData
): OrderFlowQuote | undefined {
  const quote = data.items[0];
  if (!quote) return undefined;
  const latestPrice = directNumber(quote.latest);
  const previousClose = directNumber(quote.previous_close);
  if (latestPrice === null && previousClose === null) return undefined;
  return {
    latestPrice,
    previousClose,
    updatedAt: Date.now()
  };
}

/** V1 实时推送仍返回数字字段记录；统一实时连接标准化前保留此解析器。 */
export function parseOrderFlowQuote(data: unknown): OrderFlowQuote | undefined {
  const record = firstRawRecord(data);
  if (!record) return undefined;
  return {
    latestPrice: fieldNumber(record, "10"),
    previousClose: fieldNumber(record, "6"),
    updatedAt: Date.now()
  };
}

export function parseOrderFlowRecords(
  data: unknown,
  kind: OrderFlowRecordKind,
  detailKind: OrderFlowDetailKind
): OrderFlowRecord[] {
  const semanticBatches = asObject(data)?.semantic_records;
  if (!Array.isArray(semanticBatches)) return [];
  const records: OrderFlowRecord[] = [];
  for (const batch of semanticBatches) {
    if (!Array.isArray(batch)) continue;
    for (const item of batch) {
      const semantic = asObject(item);
      const values = asObject(semantic?.values);
      const derived = asObject(semantic?.derived);
      if (!values || !derived) continue;
      const price = fieldValueNumber(values.price)
        ?? fieldValueNumber(values.latest_price);
      const volume = fieldValueNumber(values.volume);
      const amount = fieldValueNumber(values.amount)
        ?? (price !== null && volume !== null ? price * volume : null);
      const timestamp = derivedTimestamp(derived)
        ?? strictTimestamp(fieldValueNumber(values.cancel_time))
        ?? strictTimestamp(fieldValueNumber(values.order_time));
      const orderTimestamp = kind === "cancel"
        ? strictTimestamp(fieldValueNumber(values.request_time))
        : null;
      const side = derivedSide(derived, detailKind);
      const orderNumber = fieldValue(values.order_no);
      records.push({
        id: [kind, orderNumber, timestamp, price, volume].join(":"),
        kind,
        side,
        timestamp,
        price,
        volume,
        amount,
        orderTimestamp
      });
    }
  }
  return records;
}

function firstRawRecord(data: unknown): JsonObject | undefined {
  const batches = asObject(data)?.records;
  if (!Array.isArray(batches)) return undefined;
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const record of batch) {
      const object = asObject(record);
      if (object) return object;
    }
  }
  return undefined;
}

function fieldNumber(record: JsonObject, fieldId: string): number | null {
  return fieldValueNumber(record[fieldId]);
}

function fieldValue(value: unknown): string | number | null {
  const object = asObject(value);
  const payload = object && "value" in object ? object.value : value;
  return typeof payload === "string" || typeof payload === "number" ? payload : null;
}

function fieldValueNumber(value: unknown): number | null {
  const payload = fieldValue(value);
  if (payload === null) return null;
  const number = typeof payload === "number" ? payload : Number(payload);
  return Number.isFinite(number) ? number : null;
}

function directNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function derivedTimestamp(derived: JsonObject): number | null {
  const timestamp = asObject(derived.timestamp);
  return strictTimestamp(typeof timestamp?.unix_milliseconds === "number"
    ? timestamp.unix_milliseconds
    : null);
}

function strictTimestamp(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 1_000_000_000_000) return value;
  if (value >= 1_000_000_000) return value * 1_000;
  return null;
}

function derivedSide(derived: JsonObject, detailKind: OrderFlowDetailKind): OrderFlowSide {
  if (detailKind === "buy_cancel") return "buy";
  if (detailKind === "sell_cancel") return "sell";
  const side = derived.side;
  return side === "buy" || side === "sell" ? side : "unknown";
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
