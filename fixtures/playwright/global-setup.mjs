import { waitForEmulators } from '../../playwright/helpers.mjs';
export default () => waitForEmulators(['firestore', 'auth']);
