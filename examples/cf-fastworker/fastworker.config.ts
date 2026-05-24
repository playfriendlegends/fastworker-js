import type { FastworkerConfig } from 'fastworker-js';

export default {
  deployMode: 'monolith',
  adapter: 'cloudflare',
  modulesDir: './modules',
} satisfies FastworkerConfig;
