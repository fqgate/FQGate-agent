<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import ComponentFrame from "@/components/shared/ComponentFrame.vue";
import type { LoginService, QrLoginStatus, SmsCaptcha } from "@/shared/contracts";
import { isQrLoginFlowExpiredError, isSmsCaptchaRejectedError } from "@/shared/loginErrors";

const props = withDefaults(defineProps<{
  service: LoginService;
  pollIntervalMs?: number;
  embedded?: boolean;
}>(), {
  pollIntervalMs: 1_500,
  embedded: false
});

const emit = defineEmits<{
  success: [];
}>();

type SmsStep = "phone" | "captcha" | "code" | "success";
type NoticeType = "info" | "success" | "warning" | "error";

const activeTab = ref("qr");
const qrBusy = ref(false);
const qrFlowId = ref<number>();
const qrImageUrl = ref("");
const qrNotice = ref("点击下方按钮获取登录二维码。");
const qrNoticeType = ref<NoticeType>("info");
let qrPollTimer: number | undefined;

const smsBusy = ref(false);
const smsStep = ref<SmsStep>("phone");
const phoneNumber = ref("");
const verificationCode = ref("");
const smsFlowId = ref<number>();
const captcha = ref<SmsCaptcha>();
const sliderPositionX = ref(0);
const sliderPieceSize = ref({ width: 0, height: 0 });
const smsNotice = ref("");
const smsNoticeType = ref<NoticeType>("info");

const sliderMax = computed(() => {
  if (!captcha.value) return 0;
  return Math.max(
    0,
    captcha.value.imageWidth - sliderPieceSize.value.width
  );
});
const captchaStageStyle = computed(() => ({
  width: captcha.value ? `${captcha.value.imageWidth}px` : undefined
}));
const captchaPieceStyle = computed(() => {
  const item = captcha.value;
  if (!item) return {};
  const pieceWidth = sliderPieceSize.value.width;
  const pieceHeight = sliderPieceSize.value.height;
  return {
    left: `${(sliderPositionX.value / item.imageWidth) * 100}%`,
    top: `${(item.initialY / item.imageHeight) * 100}%`,
    width: pieceWidth ? `${(pieceWidth / item.imageWidth) * 100}%` : undefined,
    height: pieceHeight ? `${(pieceHeight / item.imageHeight) * 100}%` : undefined
  };
});

function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType || "image/png"};base64,${base64}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function handleCaptchaPieceLoad(event: Event): void {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement)) return;
  sliderPieceSize.value = { width: image.naturalWidth, height: image.naturalHeight };
  if (sliderPositionX.value > sliderMax.value) sliderPositionX.value = sliderMax.value;
}

function stopQrPolling(): void {
  if (qrPollTimer !== undefined) window.clearTimeout(qrPollTimer);
  qrPollTimer = undefined;
}

function scheduleQrPoll(): void {
  stopQrPolling();
  qrPollTimer = window.setTimeout(() => void pollQrLogin(), props.pollIntervalMs);
}

async function beginQrLogin(): Promise<void> {
  stopQrPolling();
  qrFlowId.value = undefined;
  qrImageUrl.value = "";
  qrBusy.value = true;
  qrNotice.value = "正在获取二维码…";
  qrNoticeType.value = "info";
  try {
    const session = await props.service.beginQrLogin();
    qrFlowId.value = session.flowId;
    qrImageUrl.value = dataUrl(session.mediaType, session.imageBase64);
    qrNotice.value = "请使用同花顺 App 扫码。";
    scheduleQrPoll();
  } catch (error) {
    qrNotice.value = errorMessage(error);
    qrNoticeType.value = "error";
  } finally {
    qrBusy.value = false;
  }
}

async function pollQrLogin(): Promise<void> {
  const flowId = qrFlowId.value;
  if (flowId === undefined || activeTab.value !== "qr") return;
  try {
    const progress = await props.service.pollQrLogin(flowId);
    if (progress.connected) {
      stopQrPolling();
      qrImageUrl.value = "";
      qrNotice.value = "行情登录成功。";
      qrNoticeType.value = "success";
      emit("success");
      return;
    }
    showQrPending(progress.status);
    scheduleQrPoll();
  } catch (error) {
    stopQrPolling();
    if (isQrLoginFlowExpiredError(error)) {
      qrFlowId.value = undefined;
      qrImageUrl.value = "";
      qrNotice.value = error.message;
      qrNoticeType.value = "warning";
      return;
    }
    qrNotice.value = errorMessage(error);
    qrNoticeType.value = "error";
  }
}

function showQrPending(status: QrLoginStatus): void {
  qrNotice.value = status === "waiting_for_confirmation"
    ? "已扫码，请在手机上确认。"
    : "请使用同花顺 App 扫码。";
}

function handleTabChange(value: string | number): void {
  activeTab.value = String(value);
  if (activeTab.value === "qr" && qrFlowId.value !== undefined && qrNoticeType.value !== "success") {
    scheduleQrPoll();
  } else if (activeTab.value === "qr" && qrFlowId.value === undefined && !qrBusy.value) {
    void beginQrLogin();
  } else {
    stopQrPolling();
  }
}

async function beginSmsLogin(): Promise<void> {
  await loadSmsCaptcha("");
}

async function loadSmsCaptcha(successNotice: string): Promise<void> {
  const phone = phoneNumber.value.trim();
  if (!/^\d{11}$/.test(phone)) {
    smsNotice.value = "请输入 11 位手机号码。";
    smsNoticeType.value = "warning";
    return;
  }
  smsBusy.value = true;
  smsNotice.value = "正在获取安全验证…";
  smsNoticeType.value = "info";
  try {
    const session = await props.service.beginSmsLogin(phone);
    smsFlowId.value = session.flowId;
    captcha.value = session.captcha;
    sliderPositionX.value = session.captcha.initialX;
    sliderPieceSize.value = { width: 0, height: 0 };
    smsStep.value = "captcha";
    smsNotice.value = successNotice;
    smsNoticeType.value = successNotice ? "warning" : "info";
  } catch (error) {
    smsNotice.value = errorMessage(error);
    smsNoticeType.value = "error";
  } finally {
    smsBusy.value = false;
  }
}

async function sendSmsCode(): Promise<void> {
  if (smsFlowId.value === undefined || !captcha.value) return;
  smsBusy.value = true;
  smsNotice.value = "正在发送短信验证码…";
  smsNoticeType.value = "info";
  try {
    // 同花顺协议中的 RelativeX/RelativeY 表示相对底图左上角的最终位置，
    // 不是相对 initX/initY 的拖动距离。
    await props.service.sendSmsCode(
      smsFlowId.value,
      sliderPositionX.value,
      captcha.value.initialY
    );
    smsStep.value = "code";
    smsNotice.value = "验证码已发送，请查看手机短信。";
    smsNoticeType.value = "success";
  } catch (error) {
    if (isSmsCaptchaRejectedError(error)) {
      await loadSmsCaptcha("位置没有对准，已刷新验证图，请重新拖动。");
      return;
    }
    smsNotice.value = errorMessage(error);
    smsNoticeType.value = "error";
  } finally {
    smsBusy.value = false;
  }
}

async function completeSmsLogin(): Promise<void> {
  const code = verificationCode.value.trim();
  if (smsFlowId.value === undefined || !/^\d{4,12}$/.test(code)) {
    smsNotice.value = "请输入短信中的验证码。";
    smsNoticeType.value = "warning";
    return;
  }
  smsBusy.value = true;
  smsNotice.value = "正在登录…";
  smsNoticeType.value = "info";
  try {
    const result = await props.service.completeSmsLogin(smsFlowId.value, code);
    if (!result.connected) throw new Error("行情服务未连接。");
    smsStep.value = "success";
    smsNotice.value = "";
    emit("success");
  } catch (error) {
    smsNotice.value = errorMessage(error);
    smsNoticeType.value = "error";
  } finally {
    smsBusy.value = false;
  }
}

function restartSmsLogin(): void {
  smsStep.value = "phone";
  smsFlowId.value = undefined;
  captcha.value = undefined;
  verificationCode.value = "";
  smsNotice.value = "";
  smsNoticeType.value = "info";
}

onBeforeUnmount(() => {
  stopQrPolling();
});
onMounted(() => void beginQrLogin());
</script>

<template>
  <ComponentFrame>
    <a-card
      class="login-panel"
      :title="embedded ? undefined : '行情登录'"
      :bordered="!embedded"
    >
    <a-tabs :active-key="activeTab" @change="handleTabChange">
      <a-tab-pane key="qr" title="App 扫码">
        <div class="qr-flow">
          <div class="qr-stage">
            <a-spin v-if="qrBusy" tip="正在获取二维码…" />
            <img v-else-if="qrImageUrl" class="qr-image" :src="qrImageUrl" alt="行情登录二维码">
            <a-result
              v-else-if="qrNoticeType === 'error'"
              status="error"
              title="二维码获取失败"
            />
            <a-result v-else-if="qrNoticeType === 'success'" status="success" title="行情登录成功" />
          </div>
          <div class="qr-notice-slot">
            <a-alert :type="qrNoticeType" show-icon>{{ qrNotice }}</a-alert>
          </div>
          <a-button type="primary" long :loading="qrBusy" @click="beginQrLogin">
            刷新二维码
          </a-button>
        </div>
      </a-tab-pane>

      <a-tab-pane key="sms" title="短信验证码">
        <div class="sms-flow">
          <div class="sms-step-stage">
          <a-form v-if="smsStep === 'phone'" :model="{ phoneNumber }" layout="vertical">
            <a-form-item label="手机号码">
              <a-input-group class="phone-input">
                <a-input class="country-code" model-value="+86" readonly />
                <a-input
                  v-model="phoneNumber"
                  allow-clear
                  inputmode="numeric"
                  maxlength="11"
                  placeholder="请输入手机号码"
                />
              </a-input-group>
            </a-form-item>
            <a-button type="primary" long :loading="smsBusy" @click="beginSmsLogin">获取验证码</a-button>
          </a-form>

          <div v-else-if="smsStep === 'captcha' && captcha" class="captcha-content">
            <div class="captcha-challenge" :style="captchaStageStyle">
              <div class="captcha-stage">
                <img
                  class="captcha-background"
                  :src="dataUrl(captcha.backgroundMediaType, captcha.backgroundImageBase64)"
                  alt="滑块验证底图"
                >
                <img
                  class="captcha-piece"
                  :style="captchaPieceStyle"
                  :src="dataUrl(captcha.sliderMediaType, captcha.sliderImageBase64)"
                  alt="滑块拼图"
                  @load="handleCaptchaPieceLoad"
                >
              </div>
              <a-slider
                v-model="sliderPositionX"
                class="captcha-slider"
                :min="0"
                :max="sliderMax"
              />
            </div>
            <a-space class="captcha-actions" direction="vertical" fill>
              <a-button type="primary" long :loading="smsBusy" @click="sendSmsCode">发送验证码</a-button>
              <a-button long @click="restartSmsLogin">更换手机号</a-button>
            </a-space>
          </div>

          <a-form v-else-if="smsStep === 'code'" :model="{ verificationCode }" layout="vertical">
            <a-form-item label="短信验证码">
              <a-input
                v-model="verificationCode"
                allow-clear
                inputmode="numeric"
                maxlength="12"
                placeholder="请输入验证码"
              />
            </a-form-item>
            <a-space direction="vertical" fill>
              <a-button type="primary" long :loading="smsBusy" @click="completeSmsLogin">登录</a-button>
              <a-button long @click="restartSmsLogin">重新获取</a-button>
            </a-space>
          </a-form>

          <a-result v-else status="success" title="行情登录成功">
            <template #extra>
              <a-button @click="restartSmsLogin">重新登录</a-button>
            </template>
          </a-result>
          </div>

          <div class="sms-notice-slot">
            <a-alert v-if="smsNotice" :type="smsNoticeType" show-icon>{{ smsNotice }}</a-alert>
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>
    </a-card>
  </ComponentFrame>
</template>

<style scoped>
.login-panel {
  box-sizing: border-box;
  width: 100%;
  --login-content-height: 380px;
}

.qr-stage {
  display: flex;
  height: 224px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.qr-flow {
  box-sizing: border-box;
  display: grid;
  height: var(--login-content-height);
  grid-template-rows: 224px 64px 28px;
  align-content: start;
  gap: 16px;
}

.qr-notice-slot :deep(.arco-alert) {
  box-sizing: border-box;
  height: 100%;
  align-items: center;
}

.qr-image {
  display: block;
  width: 224px;
  height: 224px;
  object-fit: contain;
}

.country-code {
  width: 68px;
}

.phone-input {
  width: 100%;
}

.sms-flow {
  display: grid;
  height: var(--login-content-height);
  grid-template-rows: 320px 48px;
  gap: 12px;
}

.sms-step-stage {
  min-width: 0;
  height: 320px;
  overflow: auto;
}

.sms-notice-slot {
  height: 48px;
}

.sms-notice-slot :deep(.arco-alert) {
  box-sizing: border-box;
  height: 100%;
  align-items: center;
}

.captcha-content {
  display: flex;
  height: 100%;
  align-items: center;
  flex-direction: column;
  gap: 12px;
}

.captcha-challenge {
  display: grid;
  max-width: 100%;
  gap: 8px;
}

.captcha-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  line-height: 0;
}

.captcha-background {
  display: block;
  width: 100%;
  height: auto;
}

.captcha-piece {
  position: absolute;
  outline: 2px solid rgb(var(--primary-6));
  outline-offset: -2px;
  pointer-events: none;
}

.captcha-slider,
.captcha-actions {
  width: 100%;
}
</style>
