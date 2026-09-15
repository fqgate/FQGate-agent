import { computed, ref } from "vue";
import { defineStore } from "pinia";

import { FqgateApiError } from "@/adapters/local-api/FqgateHttpClient";

import { tradingService } from "../services";
import {
  type TradingAccount,
  type TradingLoginCredentials,
  type TradingLoginResponse,
  type TradingMode,
  type TradingSession,
  type TradingSessionStatus
} from "../types";

const STORAGE_KEY = "fqgate.trading-demo-v2.session";
const PREFERENCES_KEY = "fqgate.trading-demo-v2.preferences";
const SESSION_STORAGE_VERSION = 2;
const PREFERENCES_STORAGE_VERSION = 1;

interface PersistedTradingSession {
  version: typeof SESSION_STORAGE_VERSION;
  tradingMode: TradingMode;
  session: TradingSession;
}

interface TradingPreferences {
  version: typeof PREFERENCES_STORAGE_VERSION;
  brokerId: string;
}

export const useTradingSessionStore = defineStore("trading-session", () => {
  const restoredState = readPersistedState();
  const status = ref<TradingSessionStatus>(
    restoredState ? "restoring" : "signed-out"
  );
  const session = ref<TradingSession | null>(restoredState?.session ?? null);
  const preferredBrokerId = ref(readPreferences()?.brokerId ?? restoredState?.session.brokerId ?? "");
  const tradingMode = ref<TradingMode>(restoredState?.tradingMode ?? "ordinary");
  const errorMessage = ref("");
  const initialized = ref(!restoredState);

  let requestSequence = 0;
  let pendingRequest: AbortController | undefined;
  let restorePromise: Promise<boolean> | undefined;

  const currentAccount = computed<TradingAccount | null>(() => {
    if (!session.value) return null;
    return session.value.accounts.find(
      (account) => account.accountId === session.value?.currentAccountId
    ) ?? null;
  });
  const isLoggedIn = computed(() => status.value === "signed-in" && !!currentAccount.value);
  const brokerId = computed(() => session.value?.brokerId ?? preferredBrokerId.value);
  const accessPointId = computed(() => session.value?.accessPointId ?? "");

  async function login(credentials: TradingLoginCredentials): Promise<TradingSession> {
    const sequence = ++requestSequence;
    pendingRequest?.abort();
    const controller = new AbortController();
    pendingRequest = controller;
    status.value = "signing-in";
    errorMessage.value = "";

    try {
      const response = await tradingService.login(credentials, controller.signal);
      if (sequence !== requestSequence) throw new DOMException("登录已取消", "AbortError");
      const nextSession = sessionFromLogin(response);
      session.value = nextSession;
      rememberBroker(credentials.brokerId);
      tradingMode.value = nextSession.accounts.find(
        (account) => account.accountId === nextSession.currentAccountId
      )!.tradingMode;
      status.value = "signed-in";
      initialized.value = true;
      persistState(tradingMode.value, nextSession);
      return nextSession;
    } catch (error) {
      if (sequence === requestSequence) {
        session.value = null;
        status.value = "signed-out";
        initialized.value = true;
        removePersistedState();
        errorMessage.value = userMessage(error, "登录未完成，请核对信息后重试。");
      }
      throw error;
    } finally {
      if (sequence === requestSequence) pendingRequest = undefined;
    }
  }

  /**
   * 页面刷新后以本地元数据恢复界面，再通过账户列表接口确认服务端会话仍有效。
   * SESSION_NOT_FOUND 表示 FQGate 已不再持有该会话，此时必须清理本地状态。
   */
  function restoreSession(): Promise<boolean> {
    if (restorePromise) return restorePromise;
    const stored = readPersistedState();
    if (!stored) {
      clearSessionState();
      initialized.value = true;
      return Promise.resolve(false);
    }

    session.value = stored.session;
    tradingMode.value = stored.tradingMode;
    status.value = "restoring";
    errorMessage.value = "";
    const sequence = ++requestSequence;
    const controller = new AbortController();
    pendingRequest = controller;

    restorePromise = tradingService.getAccounts(stored.session.sessionId, controller.signal)
      .then((response) => {
        if (sequence !== requestSequence) return false;
        if (response.accounts.length === 0) {
          clearSessionState();
          removePersistedState();
          errorMessage.value = "当前登录已失效，请重新登录。";
          return false;
        }
        const currentAccountId = chooseCurrentAccountId(
          response.accounts,
          stored.session.currentAccountId,
          stored.tradingMode
        );
        const restoredSession: TradingSession = {
          ...stored.session,
          accounts: response.accounts,
          currentAccountId
        };
        session.value = restoredSession;
        tradingMode.value = response.accounts.find(
          (account) => account.accountId === currentAccountId
        )!.tradingMode;
        status.value = "signed-in";
        initialized.value = true;
        persistState(tradingMode.value, restoredSession);
        return true;
      })
      .catch((error: unknown) => {
        if (sequence !== requestSequence) return false;
        initialized.value = true;
        if (isSessionNotFound(error)) {
          clearSessionState();
          removePersistedState();
          errorMessage.value = "当前登录已失效，请重新登录。";
        } else {
          status.value = "restore-failed";
          errorMessage.value = userMessage(
            error,
            "暂时无法确认登录状态，请检查 FQGate 是否已启动。"
          );
        }
        return false;
      })
      .finally(() => {
        if (sequence === requestSequence) pendingRequest = undefined;
        restorePromise = undefined;
      });
    return restorePromise;
  }

  function selectAccount(accountId: string): boolean {
    const currentSession = session.value;
    const account = currentSession?.accounts.find((item) => item.accountId === accountId);
    if (!currentSession || !account) return false;
    currentSession.currentAccountId = account.accountId;
    tradingMode.value = account.tradingMode;
    persistState(tradingMode.value, currentSession);
    return true;
  }

  function rememberBroker(brokerId: string): void {
    const normalized = brokerId.trim();
    if (!normalized) return;
    preferredBrokerId.value = normalized;
    persistPreferences(normalized);
  }

  /** 当前交易接口没有服务端退出路由，退出只清理内存和本机持久化状态。 */
  function logout(): void {
    ++requestSequence;
    pendingRequest?.abort();
    pendingRequest = undefined;
    restorePromise = undefined;
    clearSessionState();
    initialized.value = true;
    removePersistedState();
  }

  function expireSession(sessionId: string): void {
    if (session.value?.sessionId !== sessionId) return;
    ++requestSequence;
    pendingRequest?.abort();
    pendingRequest = undefined;
    restorePromise = undefined;
    clearSessionState();
    initialized.value = true;
    removePersistedState();
    errorMessage.value = "当前登录已失效，请重新登录。";
  }

  function clearError(): void {
    errorMessage.value = "";
  }

  // 任意交易接口确认会话失效时，统一清理内存和本机状态。
  tradingService.onSessionInvalid(expireSession);

  // Store 首次创建时自动校验本地会话，路由和组件只需观察 initialized/status。
  if (restoredState) void restoreSession();

  return {
    status,
    session,
    tradingMode,
    errorMessage,
    initialized,
    currentAccount,
    isLoggedIn,
    brokerId,
    accessPointId,
    login,
    restoreSession,
    selectAccount,
    rememberBroker,
    logout,
    clearError
  };

  function clearSessionState(): void {
    session.value = null;
    tradingMode.value = "ordinary";
    status.value = "signed-out";
  }
});

function sessionFromLogin(response: TradingLoginResponse): TradingSession {
  const currentAccountId = chooseCurrentAccountId(
    response.accounts,
    response.accountId,
    response.tradingMode
  );
  if (!currentAccountId) {
    throw new Error("登录成功，但未返回可用交易账户。请重新登录。");
  }
  return {
    sessionId: response.sessionId,
    brokerId: response.brokerId,
    accessPointId: response.accessPointId,
    cryptProtocol: response.cryptProtocol,
    accounts: response.accounts,
    currentAccountId
  };
}

function chooseCurrentAccountId(
  accounts: TradingAccount[],
  preferredAccountId: string,
  preferredMode: TradingMode
): string {
  return accounts.find((account) => account.accountId === preferredAccountId)?.accountId
    ?? accounts.find((account) => account.tradingMode === preferredMode)?.accountId
    ?? accounts[0]?.accountId
    ?? "";
}

function isSessionNotFound(error: unknown): boolean {
  return error instanceof FqgateApiError && error.code === "SESSION_NOT_FOUND";
}

function userMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function persistState(tradingMode: TradingMode, session: TradingSession): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  const payload: PersistedTradingSession = {
    version: SESSION_STORAGE_VERSION,
    tradingMode,
    session
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式或存储空间不足时仍允许当前页面继续使用内存会话。
  }
}

function readPersistedState(): PersistedTradingSession | null {
  const storage = localStorageOrNull();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const restored = normalizePersistedTradingSession(parsed);
    if (restored) return restored;
    storage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

function removePersistedState(): void {
  try {
    localStorageOrNull()?.removeItem(STORAGE_KEY);
  } catch {
    // localStorage 不可用时，Store 内存状态仍会按预期清理。
  }
}

function persistPreferences(brokerId: string): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  const payload: TradingPreferences = { version: PREFERENCES_STORAGE_VERSION, brokerId };
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(payload));
  } catch {
    // 偏好保存失败不影响当前页面继续选择券商。
  }
}

function readPreferences(): TradingPreferences | null {
  const storage = localStorageOrNull();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed)
      && parsed.version === PREFERENCES_STORAGE_VERSION
      && isNonEmptyString(parsed.brokerId)
      ? { version: PREFERENCES_STORAGE_VERSION, brokerId: parsed.brokerId }
      : null;
  } catch {
    return null;
  }
}

function localStorageOrNull(): Storage | null {
  return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
}

/**
 * 第一版把 tradingMode 误命名为 accountType。读取时完成一次兼容转换，
 * 避免界面字段纠正后让仍然有效的本机会话无故退出。
 */
function normalizePersistedTradingSession(value: unknown): PersistedTradingSession | null {
  if (!isRecord(value) || !isTradingSession(value.session)) return null;
  const tradingMode = value.version === SESSION_STORAGE_VERSION
    ? value.tradingMode
    : value.version === 1
      ? value.accountType
      : undefined;
  if (tradingMode !== "ordinary" && tradingMode !== "credit") return null;
  return {
    version: SESSION_STORAGE_VERSION,
    tradingMode,
    session: value.session
  };
}

/** localStorage 内容不可信，恢复前只接收字段完整的会话元数据。 */
function isTradingSession(session: unknown): session is TradingSession {
  if (!isRecord(session)) return false;
  if (
    !isNonEmptyString(session.sessionId)
    || !isNonEmptyString(session.brokerId)
    || !isNonEmptyString(session.accessPointId)
    || typeof session.cryptProtocol !== "string"
    || !isNonEmptyString(session.currentAccountId)
    || !Array.isArray(session.accounts)
  ) return false;
  if (!session.accounts.every(isTradingAccount)) return false;
  return session.accounts.some(
    (account) => account.accountId === session.currentAccountId
  );
}

function isTradingAccount(value: unknown): value is TradingAccount {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.accountId)
    && isNonEmptyString(value.fundAccount)
    && (value.tradingMode === "ordinary" || value.tradingMode === "credit");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
