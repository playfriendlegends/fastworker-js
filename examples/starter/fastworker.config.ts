import type { FastworkerConfig } from 'fastworker-js';

const isProd = process.env.NODE_ENV === 'production';

/**
 * fastworker configuration for the starter example.
 *
 * This demonstrates:
 * - Microservices deploy mode with module grouping
 * - Cloudflare adapter with Service Bindings
 * - Environment-aware services URLs (dev vs prod)
 * - Workers map grouping users + auth into one worker
 */
export default {
  deployMode: 'microservices',
  adapter: 'cloudflare',
  modulesDir: './modules',

  // ── Infrastructure Grouping ──
  // Group related modules into named workers.
  // The compiler auto-generates wrangler.toml [[services]] blocks from this.
  workers: {
    account_service: ['users', 'auth'],
    billing_service: ['billing'],
  },

  // ── RPC Address Book ──
  // Tells the gateway where to find each worker.
  // In dev: localhost URLs → ports extracted for local server binding.
  // In prod: public domains → gateway fetches via HTTPS.
  //
  // NOTE: These are routing targets for the RPC client (caller).
  // They do NOT configure which port the generated server binds to.
  services: {
    account_service: isProd
      ? 'https://account.api.example.com'
      : 'http://localhost:3001',
    billing_service: isProd
      ? 'https://billing.api.example.com'
      : 'http://localhost:3002',
  },
} satisfies FastworkerConfig;
