import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * SeqPage 构建配置
 *
 * 关键点：
 * 1. `base: './'` —— 扩展页面运行在 chrome-extension:// 协议下，
 *    必须使用相对资源路径，否则打包后的 js/css 会 404。
 * 2. manifest.json 与静态资源放在 `public/`，Vite 会原样拷贝到 `dist/`，
 *    因此 dist/ 可以直接作为「加载已解压的扩展程序」目录。
 * 3. 不使用任何 CDN，所有依赖均打包进产物（MV3 CSP 禁止远程脚本）。
 */
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    // 新标签页是单入口 SPA，资源内联阈值调小以免产生过多小文件
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 稳定的文件名，便于排查产物
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
