// Stands in for an app's build: writes the Worker the deploy then bundles.
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/worker.js', "export default { fetch: () => new Response('ok') };\n");
