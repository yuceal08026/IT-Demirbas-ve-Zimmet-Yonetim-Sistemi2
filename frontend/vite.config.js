import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Geliştirmede API istekleri Vite üzerinden backend'e aktarılır.
// Böylece tarayıcı için frontend ve API aynı adresten gelir (httpOnly cookie + CORS gerekmez).
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Derleme çıktısı /static altında: uygulamanın /assets/:id sayfa yollarıyla çakışmasın.
  build: { assetsDir: 'static' },
  server: {
    port: 5173,
    proxy: {
      '/api': API_TARGET,
      '/health': API_TARGET,
    },
  },
});
