import { createRouter, createWebHistory } from "vue-router";

import { useTradingSessionStore } from "~/stores";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      redirect: { name: "login" }
    },
    {
      path: "/login",
      name: "login",
      component: () => import("~/views/LoginView.vue"),
      meta: { title: "登录" }
    },
    {
      path: "/trading",
      name: "trading",
      component: () => import("~/views/TradingView.vue"),
      meta: { title: "交易" }
    }
  ]
});

router.beforeEach(async (to) => {
  const sessionStore = useTradingSessionStore();

  // 首次进入页面时等待本地会话校验完成，避免先显示登录页再跳转。
  if (!sessionStore.initialized) {
    await sessionStore.restoreSession();
  }

  if (to.name === "trading" && !sessionStore.isLoggedIn) {
    return { name: "login", replace: true };
  }

  if (to.name === "login" && sessionStore.isLoggedIn) {
    return { name: "trading", replace: true };
  }

  return true;
});

router.afterEach((to) => {
  const pageTitle = typeof to.meta.title === "string" ? to.meta.title : "交易服务";
  document.title = `${pageTitle} · FQGate`;
});

export default router;
