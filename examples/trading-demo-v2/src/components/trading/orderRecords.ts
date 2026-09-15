import type { TableColumn, TradingMode } from "~/types";
import type { TradingRecord } from "./types";

export interface CancelOrderFields {
  contractNumber: string;
  marketCode: string;
  shareholderAccount: string;
  securityCode: string;
  orderDate: string;
  reportNumber: string;
  cancelQuantity: string;
  matchNumber: string;
}

export interface CancelOrderRecord extends TradingRecord {
  __rowKey: string;
  __cancelFields: CancelOrderFields;
  __canCancel: boolean;
  __disabledReason: string;
  orderTime: string;
  security: string;
  direction: string;
  price: string;
  orderQuantity: string;
  filledQuantity: string;
  orderStatus: string;
}

interface FieldDescriptor {
  keys: string[];
  labels: string[];
}

const fields = {
  securityCode: descriptor(["securityCode", "xd_2102", "zqdm"], ["证券代码", "股票代码"]),
  securityName: descriptor(["securityName", "xd_2103", "zqmc"], ["证券名称", "股票名称"]),
  direction: descriptor(
    ["direction", "xd_2109", "xd_2152", "xd_3680", "mmlb"],
    ["操作", "方向", "委托类型", "买卖方向"]
  ),
  price: descriptor(["price", "xd_3015", "wtjg"], ["委托价格", "委托价"]),
  orderQuantity: descriptor(
    ["quantity", "xd_2126", "xd_3016", "wtsl"],
    ["委托数量", "委托量"]
  ),
  filledQuantity: descriptor(
    ["filledQuantity", "xd_2128", "cjsl"],
    ["成交数量", "已成数量", "已成交数量"]
  ),
  orderStatus: descriptor(["status", "xd_3630", "wtzt"], ["委托状态", "状态"]),
  cancelableFlag: descriptor(
    ["cancelable", "canCancel", "cancelableFlag"],
    ["可撤标志", "可撤"]
  ),
  orderTime: descriptor(["orderTime", "xd_2140", "wtsj"], ["委托时间", "申报时间"]),
  contractNumber: descriptor(
    ["contractNumber", "xd_2135", "htbh"],
    ["合同编号", "合同号"]
  ),
  marketCode: descriptor(["marketCode", "xd_2167", "scdm"], ["市场代码"]),
  shareholderAccount: descriptor(
    ["shareholderAccount", "xd_2106", "xd_2107", "gdzh"],
    ["股东账号", "股东账户", "股东帐户", "证券账号", "证券账户"]
  ),
  orderDate: descriptor(["orderDate", "xd_2139", "date"], ["委托日期", "申报日期"]),
  reportNumber: descriptor(
    ["reportNumber", "xd_2262", "wtph"],
    ["申报编号", "申报号"]
  ),
  cancelQuantity: descriptor(
    ["cancelQuantity", "xd_2120", "xd_3743", "cxsl"],
    ["撤单数量", "已撤数量"]
  ),
  matchNumber: descriptor(
    ["matchNumber", "xd_2130", "cjbh"],
    ["成交编号", "成交号"]
  )
} as const;

const openStatusPattern = /可撤|已报|正报|待报|未报|部成|部分成交|已确认|已申报|等待申报|正在申报/;
const terminalStatusPattern = /已成|全成|全部成交|已撤|部撤|待撤|撤单已报|撤单中|撤废|废单|拒绝|失败|无效|已取消/;

/**
 * 委托查询返回动态 xd 字段，不同券商还可能调整中文列名。这里同时按稳定字段号、
 * 接口别名和中文列名读取；撤单界面不在组件中散落券商字段判断。
 */
export function buildCancelOrderRecords(
  items: Record<string, unknown>[],
  columns: TableColumn[],
  tradingMode: TradingMode
): CancelOrderRecord[] {
  return items.flatMap((item, index) => {
    const accessor = new OrderRecordAccessor(item, columns);
    const orderStatus = accessor.read(fields.orderStatus);
    const cancelableFlag = accessor.read(fields.cancelableFlag);
    const orderQuantity = accessor.read(fields.orderQuantity);
    const filledQuantity = accessor.read(fields.filledQuantity);
    const statusKind = classifyStatus(
      orderStatus,
      cancelableFlag,
      orderQuantity,
      filledQuantity
    );
    if (statusKind === "terminal" || statusKind === "not-open") return [];

    const cancelFields: CancelOrderFields = {
      contractNumber: accessor.read(fields.contractNumber),
      marketCode: accessor.read(fields.marketCode),
      shareholderAccount: accessor.read(fields.shareholderAccount),
      securityCode: accessor.read(fields.securityCode),
      orderDate: normalizeOrderDate(accessor.read(fields.orderDate)),
      reportNumber: accessor.read(fields.reportNumber),
      cancelQuantity: normalizeIntegerText(accessor.read(fields.cancelQuantity)),
      matchNumber: accessor.read(fields.matchNumber)
    };
    const missingReason = validateCancelFields(cancelFields, tradingMode);
    const disabledReason = statusKind === "uncertain"
      ? "委托状态不明确，请刷新记录后再操作。"
      : missingReason;
    const securityName = accessor.read(fields.securityName);
    const security = [securityName, cancelFields.securityCode].filter(Boolean).join(" ") || "未知证券";
    const rowKey = [
      cancelFields.contractNumber,
      cancelFields.securityCode,
      accessor.read(fields.orderTime),
      index
    ].join("-");

    return [{
      ...item,
      __rowKey: rowKey,
      __cancelFields: cancelFields,
      __canCancel: disabledReason === "",
      __disabledReason: disabledReason,
      orderTime: accessor.read(fields.orderTime) || "—",
      security,
      direction: accessor.read(fields.direction) || "—",
      price: accessor.read(fields.price) || "—",
      orderQuantity: orderQuantity || "—",
      filledQuantity: filledQuantity || "—",
      orderStatus: orderStatus || "状态待确认"
    }];
  });
}

function descriptor(keys: string[], labels: string[]): FieldDescriptor {
  return { keys, labels };
}

class OrderRecordAccessor {
  private readonly sources: Record<string, unknown>[];
  private readonly columnsByLabel = new Map<string, string[]>();

  constructor(item: Record<string, unknown>, columns: TableColumn[]) {
    const rawFields = isRecord(item.rawFields) ? item.rawFields : undefined;
    this.sources = rawFields ? [item, rawFields] : [item];
    for (const column of columns) {
      const label = normalizeLabel(column.label);
      const keys = this.columnsByLabel.get(label) ?? [];
      keys.push(column.key);
      this.columnsByLabel.set(label, keys);
    }
  }

  read(field: FieldDescriptor): string {
    for (const key of field.keys) {
      const value = this.readKey(key);
      if (value !== undefined) return text(value);
    }
    for (const label of field.labels) {
      for (const key of this.columnsByLabel.get(normalizeLabel(label)) ?? []) {
        const value = this.readKey(key);
        if (value !== undefined) return text(value);
      }
    }
    return "";
  }

  private readKey(candidate: string): unknown {
    for (const source of this.sources) {
      for (const key of [candidate, ...Object.keys(source).filter(
        (sourceKey) => sourceKey.startsWith(`${candidate}_`)
      )]) {
        const value = source[key];
        if (value !== undefined && value !== null && text(value) !== "") return value;
      }
    }
    return undefined;
  }
}

function classifyStatus(
  status: string,
  cancelableFlag: string,
  orderedText: string,
  filledText: string
): "open" | "uncertain" | "terminal" | "not-open" {
  const normalizedFlag = cancelableFlag.trim().toLowerCase();
  if (/^(?:是|可撤|允许|1|y|yes|true)$/.test(normalizedFlag)) return "open";
  if (/^(?:否|不可撤|不允许|0|n|no|false)$/.test(normalizedFlag)) return "terminal";
  if (terminalStatusPattern.test(status)) return "terminal";
  if (openStatusPattern.test(status)) return "open";

  const ordered = parseQuantity(orderedText);
  const filled = parseQuantity(filledText) ?? 0;
  if (ordered !== undefined && ordered > filled) return "uncertain";
  if (ordered !== undefined && ordered > 0 && filled >= ordered) return "terminal";
  return "not-open";
}

function validateCancelFields(fields: CancelOrderFields, tradingMode: TradingMode): string {
  if (!validContract(fields.contractNumber)) return "委托记录缺少有效合同编号，暂时不能撤单。";
  if (!/^[A-Za-z0-9]$/.test(fields.marketCode)) return "委托记录缺少有效市场代码，暂时不能撤单。";
  if (!/^[A-Za-z0-9]{1,15}$/.test(fields.shareholderAccount)) {
    return "委托记录缺少有效股东账号，暂时不能撤单。";
  }
  if (tradingMode === "ordinary") return "";
  if (!/^\d{6}$/.test(fields.securityCode)) return "委托记录缺少有效证券代码，暂时不能撤单。";
  if (!validOrderDate(fields.orderDate)) return "委托记录缺少有效委托日期，暂时不能撤单。";
  if (!validOptionalReference(fields.reportNumber) || !validOptionalReference(fields.matchNumber)) {
    return "委托记录中的原始编号格式不正确，暂时不能撤单。";
  }
  if (!/^(?:|\d{1,10})$/.test(fields.cancelQuantity)) {
    return "委托记录中的撤单数量格式不正确，暂时不能撤单。";
  }
  return "";
}

function validContract(value: string): boolean {
  return /^[A-Za-z0-9]{1,28}$/.test(value) && (value.length < 15 || /^\d+$/.test(value));
}

function validOptionalReference(value: string): boolean {
  return value === "" || /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

function validOrderDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeOrderDate(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function normalizeIntegerText(value: string): string {
  const normalized = value.replace(/,/g, "").trim();
  return /^\d+\.0+$/.test(normalized) ? normalized.split(".")[0] : normalized;
}

function parseQuantity(value: string): number | undefined {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeLabel(value: string): string {
  return value.replace(/[\s()（）]/g, "").toLowerCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
