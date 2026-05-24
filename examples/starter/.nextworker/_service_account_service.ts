// Auto-generated service entry: account_service (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest_account_service';
import { createRouter } from 'fastworker/runtime';

const handler = createRouter({ routes, modules: moduleMap });

export default { fetch: handler };