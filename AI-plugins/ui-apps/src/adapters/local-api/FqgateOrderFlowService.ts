import type {
  MarketSecurity,
  OrderFlowDataMode,
  OrderFlowFallbackReason,
  OrderFlowWatchConnection,
  OrderFlowWatchListener,
  OrderFlowWatchService
} from "@/shared/contracts";
import type { DataServiceConnection } from "@/shared/dataService";
import { searchFqgateSecurities } from "./FqgateSecuritySearchService";
import {
  FqgateHttpClient,
  toFqgateWebSocketUrl,
  type FqgateHttpClientOptions
} from "./FqgateHttpClient";
import type { FqgateStandardQuoteData } from "./FqgateMarketDataParsers";
import {
  parseOrderFlowQuote,
  parseOrderFlowRecords,
  parseStandardOrderFlowQuote
} from "./FqgateOrderFlowParsers";
import { toFqgateStandardSecurity } from "./FqgateStandardMarket";
import { FqgateWebSocketTransport } from "./FqgateWebSocketTransport";

interface FqgateMarketHealth {
  status: string;
  network_ready: boolean;
  connected: boolean;
  level2_permission: boolean | null;
  login_method?: string | null;
  reason?: string;
}

interface FqgateStreamMessage {
  event?: "subscribed" | "unsubscribed" | "data" | "notice" | "pong";
  subscription_id?: number;
  kind?: FqgateStreamKind;
  code?: number;
  message?: string;
  data?: unknown;
}

type FqgateStreamKind = "quote" | "order_detail" | "buy_cancel" | "sell_cancel";

export interface FqgateOrderFlowServiceOptions extends FqgateHttpClientOptions {
  webSocketFactory?: (url: string) => WebSocket;
}

/**
 * FQGate 实时逐笔适配器。权限检测、WebSocket 协议及 Level-2 降级都在
 * 适配层收口，界面组件无需了解不同数据提供方的协议差异。
 */
export class FqgateOrderFlowService implements OrderFlowWatchService {
  readonly kind = "fqgate-local-api";

  private readonly client: FqgateHttpClient;
  private readonly baseUrl: string;
  private readonly webSocketFactory: (url: string) => WebSocket;

  constructor(options: FqgateOrderFlowServiceOptions = {}) {
    this.client = new FqgateHttpClient(options);
    this.baseUrl = this.client.baseUrl;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  get connection() {
    return this.client.connection;
  }

  searchSecurities(pattern: string, signal?: AbortSignal): Promise<MarketSecurity[]> {
    return searchFqgateSecurities(this.client, pattern, signal);
  }

  async connect(
    security: MarketSecurity,
    listener: OrderFlowWatchListener,
    signal?: AbortSignal
  ): Promise<OrderFlowWatchConnection> {
    throwIfAborted(signal);
    listener.onConnectionState("connecting", "正在连接实时数据…");
    const health = await this.client.get<FqgateMarketHealth>("/v1/market/health");
    throwIfAborted(signal);
    if (!health.network_ready) {
      throw new Error(health.reason || "实时数据接口不可用，请确认 FQGate 已正常启动。");
    }

    const mode: OrderFlowDataMode = health.level2_permission === true ? "level2" : "basic";
    const fallbackReason = fallbackReasonFromHealth(health.level2_permission);
    listener.onModeChange({ mode, fallbackReason });

    const connection = new FqgateOrderFlowConnection(
      toFqgateWebSocketUrl(this.baseUrl, "/v1/market/stream"),
      security,
      mode,
      listener,
      this.webSocketFactory,
      this.client.connection
    );
    await connection.open(signal);
    void this.loadInitialQuote(security, listener, signal);
    return connection;
  }

  private async loadInitialQuote(
    security: MarketSecurity,
    listener: OrderFlowWatchListener,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const data = await this.client.post<FqgateStandardQuoteData>("/v2/market/quotes", {
        securities: [toFqgateStandardSecurity(security)],
        fields: ["latest", "previous_close"]
      }, signal);
      const quote = parseStandardOrderFlowQuote(data);
      if (quote && !signal?.aborted) listener.onQuote(quote);
    } catch {
      // WebSocket 仍是主数据通道；快照失败时继续等待下一次实时推送。
    }
  }
}

class FqgateOrderFlowConnection implements OrderFlowWatchConnection {
  private readonly transport: FqgateWebSocketTransport;
  private mode: OrderFlowDataMode;
  private readonly subscriptionKinds = new Map<number, FqgateStreamKind>();

  constructor(
    url: string,
    private readonly security: MarketSecurity,
    initialMode: OrderFlowDataMode,
    private readonly listener: OrderFlowWatchListener,
    webSocketFactory: (url: string) => WebSocket,
    dataServiceConnection: DataServiceConnection
  ) {
    this.mode = initialMode;
    this.transport = new FqgateWebSocketTransport({
      url,
      connection: dataServiceConnection,
      webSocketFactory,
      heartbeatMs: 20_000,
      failureMessage: "实时数据接口连接失败，请确认 FQGate 正在运行并已完成行情登录。",
      closedMessage: "实时数据接口已断开，请确认 FQGate 正在运行。",
      onOpen: () => {
        this.subscribeInitialChannels();
        this.listener.onConnectionState("connected", "实时数据已连接");
      },
      onMessage: (data) => this.handleMessage(data),
      onError: (error) => this.listener.onError(error.message),
      onClose: (manuallyClosed, opened) => {
        this.listener.onConnectionState(
          "closed",
          manuallyClosed ? "实时连接已暂停" : "实时连接已断开"
        );
        if (opened && !manuallyClosed) {
          this.listener.onError("实时数据接口已断开，请确认 FQGate 正在运行后重试。");
        }
      }
    });
  }

  open(signal?: AbortSignal): Promise<void> {
    return this.transport.open(signal);
  }

  close(): void {
    this.transport.close();
  }

  private subscribeInitialChannels(): void {
    this.sendSubscribe("quote", [5, 55, 10, 6]);
    if (this.mode === "level2") {
      this.sendSubscribe("order_detail", [
        "order_no", "price", "side", "volume", "amount", "order_time", "request_time"
      ]);
      const cancelFields = [
        "order_no", "latest_price", "price", "volume", "amount", "request_time", "cancel_time"
      ];
      this.sendSubscribe("buy_cancel", cancelFields);
      this.sendSubscribe("sell_cancel", cancelFields);
    }
  }

  private sendSubscribe(kind: FqgateStreamKind, fields: Array<string | number>): void {
    this.send({
      action: "subscribe",
      kind,
      market: this.security.market,
      code: this.security.code,
      fields
    });
  }

  private send(payload: unknown): void {
    this.transport.send(payload);
  }

  private handleMessage(raw: unknown): void {
    let message: FqgateStreamMessage;
    try {
      message = JSON.parse(String(raw)) as FqgateStreamMessage;
    } catch {
      this.listener.onError("实时数据返回格式异常，请稍后重试。");
      return;
    }

    if (message.event === "subscribed" && message.subscription_id !== undefined && message.kind) {
      this.subscriptionKinds.set(message.subscription_id, message.kind);
      return;
    }
    if (message.event === "notice") {
      this.handleNotice(message);
      return;
    }
    if (message.event !== "data" || !message.kind || !message.data) return;
    if (message.kind === "quote") {
      const quote = parseOrderFlowQuote(message.data);
      if (quote) this.listener.onQuote(quote);
      return;
    }
    if (this.mode !== "level2") return;

    const kind = message.kind === "order_detail" ? "order" : "cancel";
    const records = parseOrderFlowRecords(message.data, kind, message.kind);
    if (records.length) this.listener.onRecords(records);
  }

  private handleNotice(message: FqgateStreamMessage): void {
    if (message.code === 3006) {
      if (this.mode === "level2") this.fallbackToBasic();
      return;
    }
    this.listener.onError(message.message || `实时数据请求失败（${message.code ?? "未知错误"}）。`);
  }

  private fallbackToBasic(): void {
    this.mode = "basic";
    for (const [subscriptionId, kind] of this.subscriptionKinds) {
      if (kind === "quote") continue;
      this.send({ action: "unsubscribe", subscription_id: subscriptionId });
      this.subscriptionKinds.delete(subscriptionId);
    }
    this.listener.onModeChange({ mode: "basic", fallbackReason: "permission_denied" });
    this.listener.onConnectionState("connected", "已回退到普通实时行情");
  }
}

function fallbackReasonFromHealth(permission: boolean | null): OrderFlowFallbackReason | undefined {
  if (permission === false) return "level2_not_enabled";
  if (permission === null) return "level2_unknown";
  return undefined;
}

function abortError(): DOMException {
  return new DOMException("连接已取消", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
