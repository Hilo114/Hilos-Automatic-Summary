import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { defineConfig } from 'vite';

// 全局变量映射
const globalExternals: Record<string, string> = {
  jquery: '$',
  lodash: '_',
  showdown: 'showdown',
  toastr: 'toastr',
  vue: 'Vue',
  'vue-router': 'VueRouter',
  yaml: 'YAML',
  zod: 'z',
};

// CDN 映射
const cdnExternals: Record<string, string> = {
  sass: 'https://jspm.dev/sass',
};

// 判断是否应该外部化
function shouldExternalize(id: string, importer: string | undefined): boolean {
  // 相对路径、绝对路径、特殊前缀不外部化
  if (
    id.startsWith('-') ||
    id.startsWith('.') ||
    id.startsWith('/') ||
    id.startsWith('!') ||
    id.startsWith('http') ||
    id.startsWith('@/') ||
    isAbsolute(id)
  ) {
    return false;
  }

  // 检查文件是否存在
  if (importer) {
    const importerDir = resolve(importer, '..');
    if (existsSync(join(importerDir, id)) || existsSync(id)) {
      return false;
    }
  }

  // 如果不是 vue 或 vue-router 精确匹配，但包含 vue/react/zustand，则不外部化
  // 这样 'vue' 和 'vue-router' 会被外部化使用全局变量
  // 而 'vue-demi', 'vue3-pixi', '@vue/xxx' 等则会被打包
  if (
    ['vue', 'vue-router'].every(key => id !== key) &&
    ['vue', 'react', 'zustand'].some(key => id.includes(key))
  ) {
    return false;
  }

  // 全局变量模块或其他模块都外部化
  return true;
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@util': resolve(__dirname, 'util'),
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: (id, importer) => shouldExternalize(id, importer),
      output: {
        globals: globalExternals,
        paths: (id: string) => {
          // 全局变量模块返回空（由 globals 处理）
          if (id in globalExternals) {
            return id;
          }
          // CDN 模块返回 CDN 地址
          if (id in cdnExternals) {
            return cdnExternals[id];
          }
          // 其他模块使用 jsdelivr CDN
          return `https://testingcf.jsdelivr.net/npm/${id}/+esm`;
        },
      },
    },
    minify: 'terser',
    terserOptions: {
      // 确保确定性输出
      mangle: {
        // 禁用属性混淆
        properties: false,
      },
    },
    sourcemap: mode === 'production' ? 'hidden' : true,
  },
}));
