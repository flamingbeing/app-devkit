// The kit's base config and emulator helpers, imported straight from this repo (in an app they come from .devkit/).
import { baseConfig } from '../../playwright/base.mjs';
import { emulatorServer } from '../../playwright/helpers.mjs';

export default baseConfig({
  testDir: 'tests',
  testMatch: '*.spec.mjs',
  globalSetup: './global-setup.mjs',
  webServer: emulatorServer({ project: 'demo-fixture', only: 'firestore,auth' }),
});
