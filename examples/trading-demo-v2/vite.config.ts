import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { ArcoResolver } from "unplugin-vue-components/resolvers";
import { defineConfig } from "vite";

const sharedUiSource = fileURLToPath(
  new URL("../../AI-plugins/ui-apps/src", import.meta.url)
);

export default defineConfig({
  plugins: [
    vue(),
    Components({
      dts: false,
      resolvers: [ArcoResolver({ sideEffect: true })]
    })
  ],
  resolve: {
    alias: {
      "@": sharedUiSource,
      "~": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL("../..", import.meta.url))]
    },
    proxy: {
      "/v1/market/stream": {
        target: "ws://127.0.0.1:17281",
        ws: true
      },
      "/v1": "http://127.0.0.1:17281",
      "/openapi.json": "http://127.0.0.1:17281"
    }
  }
});
