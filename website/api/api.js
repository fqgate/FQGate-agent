const LOCAL_OPENAPI_URL = "http://127.0.0.1:17281/openapi.json";
const LOCAL_DOCS_URL = "http://127.0.0.1:17281/docs";
const BUNDLED_OPENAPI_URL = "./openapi.json";

const sourceStatus = document.querySelector("#source-status");
const apiVersion = document.querySelector("#api-version");
const apiCount = document.querySelector("#api-count");
const loading = document.querySelector("#api-loading");
const error = document.querySelector("#api-error");
const scalarApp = document.querySelector("#scalar-app");

async function readOpenApi(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const document = await response.json();
    if (!document || typeof document !== "object" || typeof document.openapi !== "string" || !document.paths) {
      throw new Error("OpenAPI 文档格式无效");
    }
    return document;
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadOpenApi() {
  let source = "本机实时文档";
  let sourceUrl = LOCAL_OPENAPI_URL;
  let document;
  try {
    document = await readOpenApi(LOCAL_OPENAPI_URL, 1800);
  } catch {
    source = "内置 OpenAPI 文档";
    sourceUrl = BUNDLED_OPENAPI_URL;
    try {
      document = await readOpenApi(BUNDLED_OPENAPI_URL, 5000);
    } catch {
      showError();
      return;
    }
  }

  renderMeta(document, source);
  if (window.Scalar && typeof window.Scalar.createApiReference === "function") {
    window.Scalar.createApiReference("#scalar-app", {
      url: new URL(sourceUrl, window.location.href).href,
      theme: "saturn",
      darkMode: true,
      hideModels: false,
      defaultHttpClient: { targetKey: "shell", clientKey: "curl" }
    });
    installScalarOverlayGuard();
    loading.hidden = true;
    return;
  }
  showError("文档渲染组件加载失败");
}

function installScalarOverlayGuard() {
  if (!scalarApp) return;

  // Scalar 的移动端会保留隐藏的 API Client 弹层；隐藏弹层必须让出鼠标事件，避免挡住侧栏导航。
  const syncOverlayPointerEvents = () => {
    for (const overlay of scalarApp.querySelectorAll(".z-overlay")) {
      const container = overlay.querySelector(".scalar-container");
      const isHidden = container && getComputedStyle(container).pointerEvents === "none";
      const pointerEvents = isHidden ? "none" : "";
      if (overlay.style.pointerEvents !== pointerEvents) {
        overlay.style.pointerEvents = pointerEvents;
      }
    }
  };

  new MutationObserver(syncOverlayPointerEvents).observe(scalarApp, {
    attributes: true,
    subtree: true
  });
  syncOverlayPointerEvents();
}

function renderMeta(document, source) {
  const paths = Object.keys(document.paths || {});
  sourceStatus.textContent = `${source} · v${document.info?.version || "未知"}`;
  sourceStatus.dataset.source = source === "本机实时文档" ? "local" : "bundled";
  apiVersion.textContent = document.info?.version || "未知";
  apiCount.textContent = `${paths.length} 个接口`;
}

function showError(message = "接口文档暂时无法加载") {
  sourceStatus.textContent = message;
  loading.hidden = true;
  error.hidden = false;
  error.querySelector("p").textContent = "可以启动 FQGate 后刷新页面，或直接打开本机实时文档。";
  error.querySelector("a").href = LOCAL_DOCS_URL;
}

void loadOpenApi();
