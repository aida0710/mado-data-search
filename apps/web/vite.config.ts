import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    host: '127.0.0.1',
    proxy: { '/api': process.env.MDS_WEB_API_PROXY_TARGET ?? 'http://127.0.0.1:4190' },
  },
});
