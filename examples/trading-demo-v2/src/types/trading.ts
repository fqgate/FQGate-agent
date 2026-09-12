export type TradingMode = "ordinary" | "credit";

export type LoginAccountType =
  | "fundAccount"
  | "customerNumber"
  | "shenzhenAccount"
  | "shanghaiAccount"
  | "fundShareAccount"
  | "shenzhenBShareAccount"
  | "shanghaiBShareAccount";

export const TRADING_MODE_OPTIONS: ReadonlyArray<{
  label: string;
  value: TradingMode;
}> = [
  { label: "普通账户", value: "ordinary" },
  { label: "信用账户", value: "credit" }
];

export interface LoginAccountTypeOption {
  accountType: LoginAccountType;
  label: string;
  description: string;
  isDefault: boolean;
}

export interface Broker {
  brokerId: string;
  name: string;
  pinyin: string;
  serviceType: string;
  authMode: number;
}

export interface AccessPointPorts {
  cert: number | null;
  hexin: number | null;
  ssl: number | null;
  sslCert: number | null;
}

export interface AccessPoint {
  accessPointId: string;
  brokerId: string;
  name: string;
  area: string;
  host: string;
  carrier: string;
  branchId: string;
  tradeType: string;
  ports: AccessPointPorts;
}

/** 登录表单模型。password 只随本次请求传递，不进入 Store 或本地存储。 */
export interface TradingLoginCredentials {
  tradingMode: TradingMode;
  accountType: LoginAccountType;
  brokerId: string;
  accessPointId: string;
  loginAccount: string;
  password: string;
}

export interface TradingLoginRequest {
  tradingMode: TradingMode;
  accountType: LoginAccountType;
  brokerId: string;
  accessPointId: string;
  fundAccount: string;
  password: string;
}

export interface DecryptedResponse {
  operation: string;
  tradingMode: TradingMode | null;
  byteLength: number;
  text: string;
}

export interface TradingAccount {
  accountId: string;
  fundAccount: string;
  tradingMode: TradingMode;
}

export interface TradingLoginResponse {
  tradingMode: TradingMode;
  accountType: LoginAccountType;
  sessionId: string;
  accountId: string;
  fundAccount: string;
  brokerId: string;
  accessPointId: string;
  cryptProtocol: string;
  accounts: TradingAccount[];
  decryptedResponses: DecryptedResponse[];
}

export interface TradingAccountsResponse {
  sessionId: string;
  accounts: TradingAccount[];
}

export interface TradingAccountContext {
  sessionId: string;
  accountId: string;
  tradingMode: TradingMode;
}

export interface TradingDateRange {
  startDate: string;
  endDate: string;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface AssetsResponse extends TradingAccountContext {
  fundAccount: string;
  currency: string | null;
  totalAssets: number | null;
  securitiesMarketValue: number | null;
  cashBalance: number | null;
  availableCash: number | null;
  withdrawableCash: number | null;
  frozenCash: number | null;
  netAssets: number | null;
  totalLiabilities: number | null;
  availableMargin: number | null;
  maintenanceRatio: number | null;
  columns: TableColumn[];
  rawFields: Record<string, string>;
  decryptedResponse: DecryptedResponse;
}

export interface Position {
  securityCode: string;
  securityName: string;
  market: string | null;
  marketCode: string | null;
  shareholderAccount: string | null;
  securityAccount: string | null;
  quantity: number | null;
  availableQuantity: number | null;
  frozenQuantity: number | null;
  costPrice: number | null;
  averageBuyPrice: number | null;
  buyCostAmount: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  profitLoss: number | null;
  profitLossRatio: number | null;
  dailyProfitLoss: number | null;
  dailyProfitLossRatio: number | null;
  positionRatio: number | null;
  todayBuyQuantity: number | null;
  todaySellQuantity: number | null;
  rawFields: Record<string, string>;
}

export interface PositionsResponse extends TradingAccountContext {
  fundAccount: string;
  items: Position[];
  columns: TableColumn[];
  decryptedResponse: DecryptedResponse;
}

export interface TableResponse extends TradingAccountContext {
  fundAccount: string;
  startDate?: string | null;
  endDate?: string | null;
  columns: TableColumn[];
  items: Record<string, unknown>[];
  pageCount?: number;
  decryptedResponses?: DecryptedResponse[];
}

export type OpenApiMethod = "get" | "post";

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema: OpenApiSchema;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, {
    content?: Record<string, OpenApiMediaType>;
  }>;
}

export interface OpenApiDocument {
  paths: Record<string, Partial<Record<OpenApiMethod, OpenApiOperation>>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
}

export interface OpenApiContract {
  available: boolean;
  summary?: string;
  description?: string;
  properties: Record<string, OpenApiSchema>;
  required: string[];
  parameters: OpenApiParameter[];
}

/** Store 只保留交易页面继续工作所需的会话元数据，不保留原始登录响应。 */
export interface TradingSession {
  sessionId: string;
  brokerId: string;
  accessPointId: string;
  cryptProtocol: string;
  accounts: TradingAccount[];
  currentAccountId: string;
}

export type TradingSessionStatus =
  | "signed-out"
  | "signing-in"
  | "restoring"
  | "signed-in"
  | "restore-failed";
