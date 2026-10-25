import type { JsonObject } from "@/adapters/mcp-app";
import type { MarketSecurity } from "@/shared/contracts";

/**
 * 读取单证券工具参数，同时兼容标准 securities 数组与历史单证券结构。
 * 单证券界面只展示第一个有效证券，和对应 MCP 工具的单证券限制保持一致。
 */
export function readSecurity(
  argumentsValue: JsonObject | undefined,
): MarketSecurity | undefined {
  if (!argumentsValue) return undefined;

  const candidates: unknown[] = [];
  if (isJsonObject(argumentsValue.security)) {
    candidates.push(argumentsValue.security);
  }
  if (Array.isArray(argumentsValue.securities)) {
    candidates.push(...argumentsValue.securities);
  }
  candidates.push(argumentsValue);

  for (const candidate of candidates) {
    if (!isJsonObject(candidate)) continue;
    const security = parseSecurity(candidate);
    if (security) return security;
  }
  return undefined;
}

export function readSecurities(
  argumentsValue: JsonObject | undefined,
): MarketSecurity[] {
  if (!argumentsValue) return [];
  if (Array.isArray(argumentsValue.securities)) {
    return argumentsValue.securities
      .map((value) => (isJsonObject(value) ? parseSecurity(value) : undefined))
      .filter((value): value is MarketSecurity => value !== undefined);
  }
  const security = readSecurity(argumentsValue);
  return security ? [security] : [];
}

function parseSecurity(value: JsonObject): MarketSecurity | undefined {
  const market = stringValue(value.market);
  const code = stringValue(value.code);
  if (!market || !code) return undefined;
  return {
    market,
    code,
    name: stringValue(value.name),
    fullCode:
      stringValue(value.fullCode) ??
      stringValue(value.full_code) ??
      `${market}${code}`,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
