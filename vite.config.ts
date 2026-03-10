import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // DeepSeek API proxy
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, ''),
        secure: true,
      },
      // OpenAI API proxy
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ''),
        secure: true,
      },
      // Claude API proxy
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/claude/, ''),
        secure: true,
      },
      // Apify API proxy
      '/api/apify': {
        target: 'https://api.apify.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/apify/, ''),
        secure: true,
      },
      // Reoon Email Verifier API proxy
      '/api/reoon': {
        target: 'https://emailverifier.reoon.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/reoon/, '/api/v1'),
        secure: true,
      },
      // Success.ai API proxy
      '/api/successai': {
        target: 'https://api.success.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/successai/, ''),
        secure: true,
      },
    },
  },
})
