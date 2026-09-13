export type McpPollingState = "connecting" | "connected" | "reconnecting" | "closed";

export interface McpPollingConnectionOptions {
  poll(signal: AbortSignal): Promise<void>;
  onStateChange(state: McpPollingState): void;
  onError(error: Error): void;
  intervalMs?: number;
  retryIntervalMs?: number;
  initialDelayMs?: number;
  initialState?: "connecting" | "connected";
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 3_000;

/**
 * MCP Apps 不能假设组件沙箱可以直连本机 WebSocket，因此通过宿主的 MCP
 * 工具调用定时刷新。每轮请求结束后再安排下一轮，避免慢请求发生重叠。
 */
export class McpPollingConnection {
  private timer?: ReturnType<typeof globalThis.setTimeout>;
  private requestController?: AbortController;
  private state?: McpPollingState;
  private lastErrorMessage = "";
  private closed = false;
  private readonly abortFromParent = (): void => this.close();

  constructor(private readonly options: McpPollingConnectionOptions) {
    if (options.signal?.aborted) {
      this.closed = true;
      this.emitState("closed");
      return;
    }
    options.signal?.addEventListener("abort", this.abortFromParent, { once: true });
    this.emitState(options.initialState ?? "connecting");
    this.schedule(options.initialDelayMs ?? 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
    this.requestController?.abort();
    this.requestController = undefined;
    this.options.signal?.removeEventListener("abort", this.abortFromParent);
    this.emitState("closed");
  }

  private schedule(delayMs: number): void {
    if (this.closed) return;
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined;
      void this.runOnce();
    }, Math.max(0, delayMs));
  }

  private async runOnce(): Promise<void> {
    if (this.closed) return;
    const controller = new AbortController();
    this.requestController = controller;
    try {
      await this.options.poll(controller.signal);
      if (this.closed || controller.signal.aborted) return;
      this.lastErrorMessage = "";
      this.emitState("connected");
      this.schedule(this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    } catch (reason) {
      if (this.closed || controller.signal.aborted || isAbortError(reason)) return;
      const error = reason instanceof Error ? reason : new Error("实时数据刷新失败，请稍后重试。");
      if (this.state !== "reconnecting" || error.message !== this.lastErrorMessage) {
        this.options.onError(error);
      }
      this.lastErrorMessage = error.message;
      this.emitState("reconnecting");
      this.schedule(this.options.retryIntervalMs ?? DEFAULT_INTERVAL_MS);
    } finally {
      if (this.requestController === controller) this.requestController = undefined;
    }
  }

  private emitState(state: McpPollingState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange(state);
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}
