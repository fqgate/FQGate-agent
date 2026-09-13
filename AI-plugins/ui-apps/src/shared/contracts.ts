import type { DataServiceAvailability } from "./dataService";

export interface UiDataSource extends DataServiceAvailability {
  readonly kind: string;
}

export interface AiToolAdapter {
  readonly kind: string;
  initialize(): Promise<void>;
  destroy(): void;
}

export type LoginMethod = "qr" | "sms";
export type QrLoginStatus = "waiting_for_scan" | "waiting_for_confirmation";

export interface LoginResult {
  connected: true;
  method: LoginMethod;
}

export interface QrLoginSession {
  flowId: number;
  imageBase64: string;
  mediaType: string;
  status: QrLoginStatus;
}

export type QrLoginProgress =
  | { connected: false; flowId: number; status: QrLoginStatus }
  | LoginResult;

export interface SmsCaptcha {
  backgroundImageBase64: string;
  backgroundMediaType: string;
  sliderImageBase64: string;
  sliderMediaType: string;
  initialX: number;
  initialY: number;
  imageWidth: number;
  imageHeight: number;
}

export interface SmsLoginSession {
  flowId: number;
  captcha: SmsCaptcha;
}

export interface LoginService extends UiDataSource {
  beginQrLogin(): Promise<QrLoginSession>;
  pollQrLogin(flowId: number): Promise<QrLoginProgress>;
  beginSmsLogin(phoneNumber: string): Promise<SmsLoginSession>;
  sendSmsCode(flowId: number, imageX: number, imageY: number): Promise<void>;
  completeSmsLogin(flowId: number, verificationCode: string): Promise<LoginResult>;
}

export type KlineInterval =
  | "intraday"
  | "five_day"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "day"
  | "week"
  | "month";
export type KlineAdjustment = "" | "forward" | "backward";

export interface MarketSecurity {
  market: string;
  code: string;
  name?: string;
  fullCode?: string;
}

export interface CandleBar {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  turnoverRate?: number | null;
}

export interface SecuritySearchService extends UiDataSource {
  searchSecurities(pattern: string, signal?: AbortSignal): Promise<MarketSecurity[]>;
}

export interface CandleLatest extends CandleBar {
  change: number | null;
  changePercent: number | null;
}

export interface CandleData {
  security: Required<MarketSecurity>;
  interval: KlineInterval;
  intervalLabel: string;
  requestedCount: number;
  fetchedAt: string;
  latest: CandleLatest;
  bars: CandleBar[];
}

export interface CandleQuery {
  security: MarketSecurity;
  interval: KlineInterval;
  count: number;
  adjustment?: KlineAdjustment;
}

export interface CandleService extends UiDataSource {
  getCandles(query: CandleQuery): Promise<CandleData>;
}

export type MarketDepthMode = "level2" | "basic";
export type MarketDepthSide = "buy" | "sell" | "unknown";
export type MarketDepthFallbackReason = "level2_not_enabled" | "level2_unknown" | "permission_denied";

export interface MarketDepthLevel {
  level: number;
  price: number | null;
  volume: number | null;
}

export interface MarketTransaction {
  id: string;
  timestamp: number | null;
  price: number | null;
  volume: number | null;
  side: MarketDepthSide;
}

export interface MarketDepthData {
  security: Required<MarketSecurity>;
  mode: MarketDepthMode;
  fallbackReason?: MarketDepthFallbackReason;
  fetchedAt: string;
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  transactions: MarketTransaction[];
}

export interface MarketDepthService extends UiDataSource {
  getMarketDepth(security: MarketSecurity, signal?: AbortSignal): Promise<MarketDepthData>;
}

export interface MarketRealtimeQuote {
  updatedAt: number;
  latestPrice: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  turnoverRate: number | null;
}

export interface MarketRealtimePoint {
  timestamp: number;
  price: number;
  volume: number | null;
  amount: number | null;
}

export interface MarketRealtimeListener {
  onConnectionState(state: OrderFlowConnectionState, message: string): void;
  onModeChange(mode: MarketDepthMode, fallbackReason?: MarketDepthFallbackReason): void;
  onQuote(quote: MarketRealtimeQuote): void;
  onIntraday(points: MarketRealtimePoint[]): void;
  onDepth(bids: MarketDepthLevel[], asks: MarketDepthLevel[]): void;
  onTransactions(transactions: MarketTransaction[]): void;
  onResyncRequired(): void;
  onError(message: string): void;
}

export interface MarketRealtimeConnection {
  close(): void;
}

export interface MarketRealtimeService extends UiDataSource {
  connect(
    security: MarketSecurity,
    listener: MarketRealtimeListener,
    signal?: AbortSignal
  ): Promise<MarketRealtimeConnection>;
}

export type InformationCategory = "market" | "security" | "announcement";

export interface InformationItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: number | null;
  url?: string;
  securityCode?: string;
}

export interface InformationData {
  security: Required<MarketSecurity>;
  category: InformationCategory;
  fetchedAt: string;
  items: InformationItem[];
}

export interface InformationQuery {
  security: MarketSecurity;
  category: InformationCategory;
}

export interface InformationService extends UiDataSource {
  getInformation(query: InformationQuery, signal?: AbortSignal): Promise<InformationData>;
}

export type OrderFlowDataMode = MarketDepthMode;
export type OrderFlowSide = MarketDepthSide;
export type OrderFlowRecordKind = "order" | "cancel";
export type OrderFlowConnectionState = "connecting" | "connected" | "reconnecting" | "closed";
export type OrderFlowFallbackReason = MarketDepthFallbackReason;

export interface OrderFlowQuote {
  latestPrice: number | null;
  previousClose: number | null;
  updatedAt: number;
}

export interface OrderFlowRecord {
  id: string;
  kind: OrderFlowRecordKind;
  side: OrderFlowSide;
  timestamp: number | null;
  price: number | null;
  volume: number | null;
  amount: number | null;
  orderTimestamp: number | null;
}

export interface OrderFlowModeChange {
  mode: OrderFlowDataMode;
  fallbackReason?: OrderFlowFallbackReason;
}

export interface OrderFlowWatchListener {
  onConnectionState(state: OrderFlowConnectionState, message: string): void;
  onModeChange(change: OrderFlowModeChange): void;
  onQuote(quote: OrderFlowQuote): void;
  onRecords(records: OrderFlowRecord[]): void;
  onError(message: string): void;
}

export interface OrderFlowWatchConnection {
  close(): void;
}

export interface OrderFlowWatchService extends SecuritySearchService {
  connect(
    security: MarketSecurity,
    listener: OrderFlowWatchListener,
    signal?: AbortSignal
  ): Promise<OrderFlowWatchConnection>;
}
