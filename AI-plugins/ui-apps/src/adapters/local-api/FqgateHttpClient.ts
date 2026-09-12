import type { DataServiceConnection } from "@/shared/dataService";
import {
  DataServiceUnavailableError,
  isDataServiceUnavailableError
} from "@/shared/dataService";
import { getFqgateConnectionMonitor } from "./FqgateConnectionMonitor";

const defaultFqgateFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export interface FqgateHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  responseMode?: FqgateResponseMode;
}

export type FqgateResponseMode = "envelope" | "raw";

interface FqgateResponse<T> {
  code: number;
  message: string;
  data: T;
  warnings?: unknown[];
}

export class FqgateApiError extends Error {
  constructor(
    message: string,
    readonly code: number | string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "FqgateApiError";
  }
}

/**
 * 本机 FQGate HTTP 公共客户端。所有本机 API 适配器共用这里的超时、
 * 空响应和错误响应处理，避免各组件出现不一致的错误提示。
 */
export class FqgateHttpClient {
  readonly baseUrl: string;
  readonly connection: DataServiceConnection;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly responseMode: FqgateResponseMode;

  constructor(options: FqgateHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? resolveFqgateBaseUrl();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? defaultFqgateFetch;
    this.responseMode = options.responseMode ?? "envelope";
    this.connection = getFqgateConnectionMonitor({
      baseUrl: this.baseUrl,
      fetcher: this.fetcher
    });
  }

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: "GET" }, signal);
  }

  async post<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    serverTimeoutMs?: number,
    headers?: HeadersInit
  ): Promise<T> {
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
    if (serverTimeoutMs) {
      requestHeaders.set("X-Request-Timeout-Ms", String(serverTimeoutMs));
    }
    return this.request<T>(path, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body)
    }, signal);
  }

  private async request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    if (this.connection.getSnapshot().state === "reconnecting") {
      throw new DataServiceUnavailableError("数据服务正在重连，请稍候。");
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        signal: controller.signal
      });
      const responseText = await response.text();
      if (!responseText.trim()) {
        if (!response.ok) throw new DataServiceUnavailableError();
        throw new Error("FQGate 返回了空响应，请稍后重试。");
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        if (response.status >= 500) throw new DataServiceUnavailableError();
        throw new Error(`FQGate 返回格式异常（HTTP ${response.status}）。`);
      }

      if (this.responseMode === "raw") {
        if (!response.ok) throw rawResponseError(payload, response.status);
        return payload as T;
      }

      const envelope = payload as FqgateResponse<T>;
      if (!response.ok || envelope.code !== 0) {
        throw new FqgateApiError(
          envelope.message || `请求失败（HTTP ${response.status}）`,
          envelope.code,
          response.status
        );
      }
      return envelope.data;
    } catch (error) {
      let normalizedError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        normalizedError = timedOut
          ? new DataServiceUnavailableError("连接 FQGate 超时，正在等待服务恢复。")
          : new Error("请求已取消。");
      } else if (error instanceof TypeError) {
        normalizedError = new DataServiceUnavailableError();
      }
      if (isDataServiceUnavailableError(normalizedError)) this.connection.reportUnavailable();
      throw normalizedError;
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function rawResponseError(payload: unknown, httpStatus: number): FqgateApiError {
  const body = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const code = typeof body.code === "string" || typeof body.code === "number"
    ? body.code
    : "REQUEST_FAILED";
  const message = typeof body.message === "string"
    ? body.message
    : typeof body.error === "string"
      ? body.error
      : `请求失败（HTTP ${httpStatus}）`;
  return new FqgateApiError(message, code, httpStatus);
}

export function resolveFqgateBaseUrl(): string {
  const origin = globalThis.location?.origin;
  return origin && /^https?:\/\//.test(origin) ? origin : "http://127.0.0.1:17281";
}

export function toFqgateWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
