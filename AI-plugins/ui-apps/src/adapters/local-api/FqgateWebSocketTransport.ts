import type { DataServiceConnection } from "@/shared/dataService";

export interface FqgateWebSocketTransportOptions {
  url: string;
  connection: DataServiceConnection;
  webSocketFactory?: (url: string) => WebSocket;
  heartbeatMs?: number;
  failureMessage?: string;
  closedMessage?: string;
  onOpen(): void;
  onMessage(data: unknown): void;
  onError(error: Error): void;
  onClose(manuallyClosed: boolean, opened: boolean): void;
}

/**
 * FQGate 本机 WebSocket 的公共传输层。统一处理建连、取消、心跳、关闭和
 * 数据服务状态上报；上层只负责订阅协议与业务数据解析。
 */
export class FqgateWebSocketTransport {
  private socket?: WebSocket;
  private heartbeatTimer?: ReturnType<typeof globalThis.setInterval>;
  private signal?: AbortSignal;
  private releaseAbortListener?: () => void;
  private opened = false;
  private manuallyClosed = false;

  constructor(private readonly options: FqgateWebSocketTransportOptions) {}

  open(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      let settled = false;
      const socketFactory = this.options.webSocketFactory ?? ((url: string) => new WebSocket(url));
      const socket = socketFactory(this.options.url);
      this.socket = socket;
      this.signal = signal;

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const abort = (): void => {
        this.manuallyClosed = true;
        this.stopHeartbeat();
        this.releaseAbortListener?.();
        this.releaseAbortListener = undefined;
        if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, "panel hidden");
        rejectOnce(abortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.releaseAbortListener = () => signal?.removeEventListener("abort", abort);

      socket.onopen = () => {
        if (signal?.aborted) {
          abort();
          return;
        }
        this.opened = true;
        this.startHeartbeat();
        this.options.onOpen();
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      socket.onmessage = (event) => this.options.onMessage(event.data);
      socket.onerror = () => {
        const error = new Error(this.options.failureMessage || "WebSocket 连接异常。");
        this.options.connection.reportUnavailable();
        this.options.onError(error);
        rejectOnce(error);
        if (socket.readyState === 0 || socket.readyState === 1) socket.close();
      };
      socket.onclose = () => {
        this.releaseAbortListener?.();
        this.releaseAbortListener = undefined;
        this.stopHeartbeat();
        if (!this.manuallyClosed) this.options.connection.reportUnavailable();
        this.options.onClose(this.manuallyClosed, this.opened);
        rejectOnce(new Error(this.options.closedMessage || "WebSocket 连接已断开。"));
      };
    });
  }

  send(payload: unknown): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(payload));
  }

  close(reason = "panel hidden"): void {
    if (this.manuallyClosed) return;
    this.manuallyClosed = true;
    this.stopHeartbeat();
    this.releaseAbortListener?.();
    this.releaseAbortListener = undefined;
    this.signal = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      socket.close(1000, reason);
    }
  }

  private startHeartbeat(): void {
    const heartbeatMs = this.options.heartbeatMs;
    if (!heartbeatMs || heartbeatMs <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = globalThis.setInterval(() => this.send({ action: "ping" }), heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) globalThis.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}

function abortError(): DOMException {
  return new DOMException("连接已取消", "AbortError");
}
