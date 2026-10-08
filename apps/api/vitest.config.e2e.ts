import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-only-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-only-refresh-secret-at-least-32-characters',
    },
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
