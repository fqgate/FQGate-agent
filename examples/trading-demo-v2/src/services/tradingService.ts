import {
  FqgateApiError,
  FqgateHttpClient,
  toFqgateWebSocketUrl,
  type FqgateHttpClientOptions
} from "@/adapters/local-api/FqgateHttpClient";
import {
  FqgateWebSocketTransport,
  type FqgateWebSocketTransportOptions
} from "@/adapters/local-api/FqgateWebSocketTransport";

import {
  type AccessPoint,
  type AssetsResponse,
  type Broker,
  type LoginAccountTypeOption,
  type OpenApiContract,
  type OpenApiDocument,
  type OpenApiMethod,
  type OpenApiSchema,
  type PositionsResponse,
  type TableResponse,
  type TradingAccountContext,
  type TradingAccountsResponse,
  type TradingDateRange,
  type TradingLoginCredentials,
  type TradingLoginRequest,
  type TradingLoginResponse
} from "../types";

export type TradingServiceOptions = Omit<FqgateHttpClientOptions, "responseMode">;

export type MarketStreamOptions = Omit<
  FqgateWebSocketTransportOptions,
  "url" | "connection"
>;

const MARKET_STREAM_PATH = "/v1/market/stream";
const SESSION_NOT_FOUND = "SESSION_NOT_FOUND";

export type TradingSessionInvalidListener = (sessionId: string) => void;

/**
 * 交易示例的本机服务入口。HTTP 与 WebSocket 都复用 ui-apps 的统一底层，
 * 这里只处理交易接口路径和界面模型到接口模型的转换。
 */
export class FqgateTradingService {
  private readonly client: FqgateHttpClient;
  private readonly sessionInvalidListeners = new Set<TradingSessionInvalidListener>();
  private openApiRequest?: Promise<OpenApiDocument>;

  constructor(options: TradingServiceOptions = {}) {
    this.client = new FqgateHttpClient({
      ...options,
      // 交易接口直接返回业务 JSON，不使用行情接口的 code/message/data 包装。
      responseMode: "raw"
    });
  }

  get connection() {
    return this.client.connection;
  }

  getBrokers(signal?: AbortSignal): Promise<Broker[]> {
    return this.client.get<Broker[]>("/v1/trading/brokers", signal);
  }

  getLoginAccountTypes(signal?: AbortSignal): Promise<LoginAccountTypeOption[]> {
    return this.client.get<LoginAccountTypeOption[]>(
      "/v1/trading/login-account-types",
      signal
    );
  }

  getAccessPoints(brokerId: string, signal?: AbortSignal): Promise<AccessPoint[]> {
    const normalizedBrokerId = brokerId.trim();
    if (!normalizedBrokerId) return Promise.resolve([]);
    return this.client.get<AccessPoint[]>(
      `/v1/trading/brokers/${encodeURIComponent(normalizedBrokerId)}/access-points`,
      signal
    );
  }

  login(
    credentials: TradingLoginCredentials,
    signal?: AbortSignal
  ): Promise<TradingLoginResponse> {
    const request: TradingLoginRequest = {
      tradingMode: credentials.tradingMode,
      accountType: credentials.accountType,
      brokerId: credentials.brokerId,
      accessPointId: credentials.accessPointId,
      // FQGate 为兼容既有客户端保留 fundAccount 字段名，其含义由 accountType 决定。
      fundAccount: credentials.loginAccount,
      password: credentials.password
    };
    return this.client.post<TradingLoginResponse>(
      "/v1/trading/sessions/login",
      request,
      signal
    );
  }

  getAccounts(sessionId: string, signal?: AbortSignal): Promise<TradingAccountsResponse> {
    const query = new URLSearchParams({ sessionId });
    return this.observeSession(
      sessionId,
      this.client.get<TradingAccountsResponse>(
        `/v1/trading/accounts?${query.toString()}`,
        signal
      )
    );
  }

  getAssets(
    context: TradingAccountContext,
    signal?: AbortSignal
  ): Promise<AssetsResponse> {
    return this.observeSession(
      context.sessionId,
      this.client.get<AssetsResponse>(
        `/v1/trading/assets?${accountQuery(context).toString()}`,
        signal
      )
    );
  }

  getPositions(
    context: TradingAccountContext,
    signal?: AbortSignal
  ): Promise<PositionsResponse> {
    return this.observeSession(
      context.sessionId,
      this.client.get<PositionsResponse>(
        `/v1/trading/positions?${accountQuery(context).toString()}`,
        signal
      )
    );
  }

  getTable(
    path: string,
    context: TradingAccountContext,
    dates?: TradingDateRange,
    signal?: AbortSignal
  ): Promise<TableResponse> {
    const normalizedPath = tradingApiPath(path);
    const query = accountQuery(context);
    if (dates) {
      query.set("startDate", dates.startDate);
      query.set("endDate", dates.endDate);
    }
    return this.observeSession(
      context.sessionId,
      this.client.get<TableResponse>(`${normalizedPath}?${query.toString()}`, signal)
    );
  }

  submit<T = unknown>(
    path: string,
    payload: unknown,
    headers?: HeadersInit,
    signal?: AbortSignal
  ): Promise<T> {
    const sessionId = readSessionId(payload);
    const request = this.client.post<T>(
      tradingApiPath(path),
      payload,
      signal,
      undefined,
      headers
    );
    return sessionId ? this.observeSession(sessionId, request) : request;
  }

  onSessionInvalid(listener: TradingSessionInvalidListener): () => void {
    this.sessionInvalidListeners.add(listener);
    return () => this.sessionInvalidListeners.delete(listener);
  }

  async getOpenApiContract(
    path: string,
    method: OpenApiMethod,
    signal?: AbortSignal
  ): Promise<OpenApiContract | null> {
    const document = await this.getOpenApiDocument(signal);
    const operation = document.paths[path]?.[method];
    if (!operation) return null;

    const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
    const input = resolveSchema(document, bodySchema);
    const properties = Object.fromEntries(
      Object.entries(input?.properties ?? {}).map(([key, schema]) => [
        key,
        resolveSchema(document, schema) ?? schema
      ])
    );
    return {
      available: Object.keys(operation.responses ?? {}).some((code) => /^2\d\d$/.test(code)),
      summary: operation.summary,
      description: operation.description,
      properties,
      required: input?.required ?? [],
      parameters: (operation.parameters ?? []).map((parameter) => ({
        ...parameter,
        schema: resolveSchema(document, parameter.schema) ?? parameter.schema
      }))
    };
  }

  /** 创建统一行情流传输；由调用方决定订阅内容和连接生命周期。 */
  createMarketStream(options: MarketStreamOptions): FqgateWebSocketTransport {
    return new FqgateWebSocketTransport({
      ...options,
      url: toFqgateWebSocketUrl(this.client.baseUrl, MARKET_STREAM_PATH),
      connection: this.client.connection
    });
  }

  private getOpenApiDocument(signal?: AbortSignal): Promise<OpenApiDocument> {
    if (!this.openApiRequest) {
      this.openApiRequest = this.client.get<OpenApiDocument>("/openapi.json", signal)
        .catch((error: unknown) => {
          this.openApiRequest = undefined;
          throw error;
        });
    }
    return this.openApiRequest;
  }

  /**
   * 会话失效属于整个交易工作台的状态变化，而不是某个表格自己的错误。
   * 在服务出口统一广播，并携带请求所用的 sessionId，避免旧请求误退新登录。
   */
  private async observeSession<T>(sessionId: string, request: Promise<T>): Promise<T> {
    try {
      return await request;
    } catch (error) {
      if (error instanceof FqgateApiError && error.code === SESSION_NOT_FOUND) {
        for (const listener of this.sessionInvalidListeners) listener(sessionId);
      }
      throw error;
    }
  }
}

export const tradingService = new FqgateTradingService();

export const getBrokers = (signal?: AbortSignal) => tradingService.getBrokers(signal);

export const getLoginAccountTypes = (signal?: AbortSignal) =>
  tradingService.getLoginAccountTypes(signal);

export const getAccessPoints = (brokerId: string, signal?: AbortSignal) =>
  tradingService.getAccessPoints(brokerId, signal);

export const login = (credentials: TradingLoginCredentials, signal?: AbortSignal) =>
  tradingService.login(credentials, signal);

export const getAccounts = (sessionId: string, signal?: AbortSignal) =>
  tradingService.getAccounts(sessionId, signal);

export const getAssets = (context: TradingAccountContext, signal?: AbortSignal) =>
  tradingService.getAssets(context, signal);

export const getPositions = (context: TradingAccountContext, signal?: AbortSignal) =>
  tradingService.getPositions(context, signal);

export const getTable = (
  path: string,
  context: TradingAccountContext,
  dates?: TradingDateRange,
  signal?: AbortSignal
) => tradingService.getTable(path, context, dates, signal);

export const submit = <T = unknown>(
  path: string,
  payload: unknown,
  headers?: HeadersInit,
  signal?: AbortSignal
) => tradingService.submit<T>(path, payload, headers, signal);

export const getOpenApiContract = (
  path: string,
  method: OpenApiMethod,
  signal?: AbortSignal
) => tradingService.getOpenApiContract(path, method, signal);

export const createMarketStream = (options: MarketStreamOptions) =>
  tradingService.createMarketStream(options);

function accountQuery(context: TradingAccountContext): URLSearchParams {
  return new URLSearchParams({
    sessionId: context.sessionId,
    accountId: context.accountId,
    tradingMode: context.tradingMode
  });
}

function tradingApiPath(path: string): string {
  const normalized = path.trim();
  if (!normalized.startsWith("/v1/trading/") || normalized.includes("?")) {
    throw new Error("交易查询地址不正确，请刷新页面后重试。");
  }
  return normalized;
}

function readSessionId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as Record<string, unknown>).sessionId;
  return typeof value === "string" ? value.trim() : "";
}

function resolveSchema(
  document: OpenApiDocument,
  schema: OpenApiSchema | undefined
): OpenApiSchema | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  if (!name) return schema;
  const referenced = document.components?.schemas?.[decodeURIComponent(name)];
  return referenced ? { ...referenced, ...schema, $ref: undefined } : schema;
}
