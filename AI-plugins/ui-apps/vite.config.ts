import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { ArcoResolver } from "unplugin-vue-components/resolvers";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    vue(),
    Components({
      dts: fileURLToPath(new URL("./src/components.d.ts", import.meta.url)),
      resolvers: [ArcoResolver({ sideEffect: true })]
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    host: "127.0.0.1",
    port: 18792,
    strictPort: true,
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
