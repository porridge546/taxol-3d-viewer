import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，保证部署在 GitHub Pages 项目子路径（/repo/）下资源可加载
  base: './',
});
