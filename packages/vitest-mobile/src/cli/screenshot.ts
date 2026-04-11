import { captureScreenshot, detectPlatform } from '../node/screenshot';
import type { Platform } from '../node/types';

export function screenshot(options: { platform?: string; output?: string }): void {
  const platform: Platform = (options.platform as Platform) ?? detectPlatform();
  const result = captureScreenshot({ platform, output: options.output });
  console.log(result.filePath);
}
