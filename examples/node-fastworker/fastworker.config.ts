import type { FastworkerConfig } from 'fastworker-js';

export default {
  deployMode: 'monolith',
  adapter: 'node',
  modulesDir: './modules',
} satisfies FastworkerConfig;
