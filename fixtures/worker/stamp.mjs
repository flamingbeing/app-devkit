// Stands in for a stamp step: proves it ran after the build and the bundle, and before the deploy.
import { existsSync, appendFileSync, readFileSync } from 'node:fs';
if (!existsSync('dist/worker.js')) throw new Error('stamp ran before the build');
if (process.env.BUNDLED && !readFileSync('site/index.html', 'utf8').includes('src="js/a.b.js"')) throw new Error('stamp ran before the bundle');
appendFileSync('dist/worker.js', '// stamped\n');
