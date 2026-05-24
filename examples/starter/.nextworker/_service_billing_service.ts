// Auto-generated service entry: billing_service (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest_billing_service';
import { createRouter } from 'fastworker/runtime';

const handler = createRouter({ routes, modules: moduleMap });

export default { fetch: handler };