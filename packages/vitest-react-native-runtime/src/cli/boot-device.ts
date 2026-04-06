/**
 * vitest-react-native-runtime boot-device — ensure a device/simulator is running.
 *
 * Usage:
 *   npx vitest-react-native-runtime boot-device android
 *   npx vitest-react-native-runtime boot-device ios
 */

import { ensureDevice } from '../node/device';
import type { Platform } from '../node/types';

const platform = process.argv[2] as Platform | undefined;

if (platform !== 'android' && platform !== 'ios') {
  console.error('Usage: npx vitest-react-native-runtime boot-device <android|ios>');
  process.exit(1);
}

try {
  await ensureDevice(platform, { headless: false });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
