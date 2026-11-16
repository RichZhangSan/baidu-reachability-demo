import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PORT || 3017);

  return {
    server: {
      host: '127.0.0.1',
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
  };
});
