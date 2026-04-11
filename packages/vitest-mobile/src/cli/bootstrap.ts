import { build } from './build';
import { install } from './install';

export async function bootstrap(platform: string, options: { appDir: string; force: boolean }): Promise<void> {
  const result = await build(platform, options);
  await install(platform, { appDir: options.appDir, buildResult: result });
}
