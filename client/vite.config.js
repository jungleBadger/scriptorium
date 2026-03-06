import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Scriptorium",
        short_name: "Scriptorium",
        description: "Explore and study scripture verse by verse.",
        theme_color: "#1e1612",
        background_color: "#fff9f2",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // /api/books?translation=WEBU  — query string is part of the cache key
            urlPattern: ({ url }) => url.pathname === "/api/books",
            handler: "CacheFirst",
            options: {
              cacheName: "api-books",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // /api/chapters/GEN/14?translation=WEBU
            urlPattern: ({ url }) => url.pathname.startsWith("/api/chapters/"),
            handler: "CacheFirst",
            options: {
              cacheName: "api-chapters",
              expiration: {
                maxEntries: 1200, // ~1 full Bible per translation
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
