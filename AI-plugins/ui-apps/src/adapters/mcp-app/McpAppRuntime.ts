import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type AppEventMap,
  type McpUiHostContext
} from "@modelcontextprotocol/ext-apps";

import { OpenAiComponentBridge, type OpenAiSnapshot } from "@/adapters/vendors/openai";

export type JsonObject = Record<string, unknown>;
export type McpToolResult = AppEventMap["toolresult"];

export interface OriginatingToolSnapshot {
  name?: string;
  arguments?: JsonObject;
  result?: McpToolResult;
}

export interface OptionalHostExtensions {
  /** 是否提供 OpenAI 兼容接口；业务组件不直接依赖此状态。 */
  openaiBridge: boolean;
}

type ToolInputListener = (argumentsValue: JsonObject) => void;
type ToolResultListener = (result: McpToolResult) => void;

/**
 * 所有厂商共用的 MCP Apps 生命周期封装。这里仅处理标准 postMessage
 * 通信、宿主样式和销毁，不感知任何具体 Vue 组件或页面布局。
 */
export class McpAppRuntime {
  readonly extensions: OptionalHostExtensions;

  private readonly app: App;
  private readonly openAiBridge: OpenAiComponentBridge;
  private readonly configuredOriginatingToolName?: string;
  private readonly inputListeners = new Set<ToolInputListener>();
  private readonly resultListeners = new Set<ToolResultListener>();
  private releaseOpenAiListener?: () => void;
  private latestArguments?: JsonObject;
  private latestResult?: McpToolResult;
  private connected = false;

  constructor(name: string, version = "0.1.0", originatingToolName?: string) {
    this.openAiBridge = new OpenAiComponentBridge();
    this.configuredOriginatingToolName = originatingToolName;
    this.extensions = Object.freeze({
      openaiBridge: this.openAiBridge.getSnapshot().available
    });
    this.app = new App(
      { name, version },
      {},
      { autoResize: true, strict: true, allowUnsafeEval: false }
    );

    // 一次性通知必须在 connect 前注册，避免严格宿主在握手后立即发送时丢失。
    this.app.addEventListener("toolinput", ({ arguments: value }) => {
      this.acceptToolInput(isJsonObject(value) ? value : {});
    });
    this.app.addEventListener("toolresult", (result) => {
      this.acceptToolResult(result);
    });
    this.releaseOpenAiListener = this.openAiBridge.subscribe((snapshot) => {
      this.acceptOpenAiSnapshot(snapshot);
    });
    this.acceptOpenAiSnapshot(this.openAiBridge.getSnapshot());
    this.app.addEventListener("hostcontextchanged", (context) => applyHostContext(context));
    this.app.onteardown = async () => {
      this.inputListeners.clear();
      this.resultListeners.clear();
      this.releaseOpenAiListener?.();
      this.releaseOpenAiListener = undefined;
      return {};
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.app.connect();
    this.connected = true;
    this.acceptOpenAiSnapshot(this.openAiBridge.getSnapshot());
    applyHostContext(this.app.getHostContext());
  }

  async callTool(name: string, argumentsValue: JsonObject): Promise<McpToolResult> {
    if (!this.connected) throw new Error("MCP App 尚未完成连接。");
    const hostSupportsStandardCall = this.app.getHostCapabilities()?.serverTools !== undefined;
    const openAiSnapshot = this.openAiBridge.getSnapshot();
    if (!hostSupportsStandardCall && openAiSnapshot.canCallTool) {
      return this.openAiBridge.callTool(name, argumentsValue);
    }
    return this.app.callServerTool({ name, arguments: argumentsValue });
  }

  getOriginatingToolSnapshot(): OriginatingToolSnapshot {
    return {
      name: this.app.getHostContext()?.toolInfo?.tool.name
        ?? this.configuredOriginatingToolName
        ?? readToolNameFromResult(this.latestResult),
      arguments: this.latestArguments,
      result: this.latestResult
    };
  }

  waitForToolInput(timeoutMs = 5_000): Promise<JsonObject | undefined> {
    if (this.latestArguments) return Promise.resolve(this.latestArguments);
    return waitForFirst(this.inputListeners, timeoutMs);
  }

  waitForToolResult(timeoutMs = 2_000): Promise<McpToolResult | undefined> {
    if (this.latestResult) return Promise.resolve(this.latestResult);
    return waitForFirst(this.resultListeners, timeoutMs);
  }

  async destroy(): Promise<void> {
    this.inputListeners.clear();
    this.resultListeners.clear();
    this.releaseOpenAiListener?.();
    this.releaseOpenAiListener = undefined;
    this.openAiBridge.destroy();
    await this.app.close();
    this.connected = false;
  }

  private acceptOpenAiSnapshot(snapshot: OpenAiSnapshot): void {
    if (snapshot.arguments) this.acceptToolInput(snapshot.arguments);
    if (snapshot.result) this.acceptToolResult(snapshot.result);
  }

  private acceptToolInput(argumentsValue: JsonObject): void {
    this.latestArguments = argumentsValue;
    for (const listener of this.inputListeners) listener(argumentsValue);
  }

  private acceptToolResult(result: McpToolResult): void {
    this.latestResult = result;
    for (const listener of this.resultListeners) listener(result);
  }
}

function waitForFirst<T>(listeners: Set<(value: T) => void>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const listener = (value: T): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      listeners.delete(listener);
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      listeners.delete(listener);
      resolve(undefined);
    }, Math.max(0, timeoutMs));
    listeners.add(listener);
  });
}

function applyHostContext(context: Partial<McpUiHostContext> | undefined): void {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

/** 兼容没有暴露 toolInfo 的 AI 宿主，从 FQGate 组件元数据恢复当前工具。 */
function readToolNameFromResult(result: McpToolResult | undefined): string | undefined {
  const metadata = result?._meta;
  if (!isJsonObject(metadata)) return undefined;
  const toolName = metadata["fqgate/uiTool"];
  return typeof toolName === "string" && toolName.trim() ? toolName : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
