import type { MarketSecurity } from "@/shared/contracts";

export type FqgateStandardMarket = "XSHG" | "XSHE";

export interface FqgateStandardSecurity {
  market: FqgateStandardMarket;
  code: string;
}

/** UI 和 V1 仍使用同花顺市场代码；V2 请求边界统一转换为标准市场代码。 */
export function toFqgateStandardSecurity(
  security: Pick<MarketSecurity, "market" | "code">
): FqgateStandardSecurity {
  return {
    market: toFqgateStandardMarket(security.market),
    code: security.code
  };
}

export function fqgateStandardSecurityKey(
  security: Pick<MarketSecurity, "market" | "code">
): string {
  const standard = toFqgateStandardSecurity(security);
  return `${standard.market}:${standard.code}`;
}

function toFqgateStandardMarket(market: string): FqgateStandardMarket {
  switch (market.toUpperCase()) {
    case "USHA":
    case "XSHG":
      return "XSHG";
    case "USZA":
    case "XSHE":
      return "XSHE";
    default:
      throw new Error(`FQGate V2 当前未确认支持市场：${market}`);
  }
}
