// Stands in for a stamp step: proves it ran after the build and before the deploy.
import { existsSync, appendFileSync } from 'node:fs';
if (!existsSync('dist/worker.js')) throw new Error('stamp ran before the build');
appendFileSync('dist/worker.js', '// stamped\n');
