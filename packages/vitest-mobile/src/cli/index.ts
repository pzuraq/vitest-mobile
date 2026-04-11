import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cac from 'cac';

const cli = cac('vitest-mobile');

cli
  .command('build <platform>', 'Build the harness binary')
  .option('--app-dir <dir>', 'App directory', { default: '.' })
  .option('--force', 'Force rebuild (clear cache)')
  .action(async (platform: string, options: { appDir: string; force: boolean }) => {
    const { build } = await import('./build');
    await build(platform, options);
  });

cli
  .command('install <platform>', 'Install harness binary on device')
  .option('--app-dir <dir>', 'App directory', { default: '.' })
  .action(async (platform: string, options: { appDir: string }) => {
    const { install } = await import('./install');
    await install(platform, options);
  });

cli
  .command('bootstrap <platform>', 'Build + install in one step')
  .option('--app-dir <dir>', 'App directory', { default: '.' })
  .option('--force', 'Force rebuild')
  .action(async (platform: string, options: { appDir: string; force: boolean }) => {
    const { bootstrap } = await import('./bootstrap');
    await bootstrap(platform, options);
  });

cli
  .command('boot-device <platform>', 'Start a simulator or emulator')
  .option('--ws-port <port>', 'WebSocket port', { default: '7878' })
  .option('--metro-port <port>', 'Metro port', { default: '18081' })
  .action(async (platform: string, options: { wsPort: string; metroPort: string }) => {
    const { ensureDevice } = await import('../node/device');
    await ensureDevice(platform as 'ios' | 'android', {
      headless: false,
      wsPort: Number(options.wsPort),
      metroPort: Number(options.metroPort),
    });
    console.log(`${platform} device ready.`);
  });

cli
  .command('screenshot', 'Take a simulator screenshot')
  .option('--platform <platform>', 'ios or android')
  .option('--output <path>', 'Output file path')
  .action(async (options: { platform?: string; output?: string }) => {
    const { screenshot } = await import('./screenshot');
    await screenshot(options);
  });

cli
  .command('debug open', 'Open the JS debugger on the device')
  .option('--metro-port <port>', 'Metro port', { default: '18081' })
  .action(async (options: { metroPort: string }) => {
    const { debugOpen } = await import('./debug');
    await debugOpen(Number(options.metroPort));
  });

cli
  .command('debug eval <expression>', 'Evaluate JS in the running app via CDP')
  .option('--metro-port <port>', 'Metro port', { default: '18081' })
  .action(async (expression: string, options: { metroPort: string }) => {
    const { debugEval } = await import('./debug');
    await debugEval(expression, Number(options.metroPort));
  });

cli.command('clean', 'Remove all cached harness binaries and generated files').action(async () => {
  const { getDefaultCacheDir } = await import('../node/harness-builder');

  const cacheDir = getDefaultCacheDir();
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
    console.log(`Removed cache directory: ${cacheDir}`);
  } else {
    console.log('No cache directory found.');
  }

  const vmDir = resolve(process.cwd(), '.vitest-mobile');
  if (existsSync(vmDir)) {
    rmSync(vmDir, { recursive: true, force: true });
    console.log(`Removed .vitest-mobile/`);
  }

  console.log('Clean complete.');
});

cli
  .command('clean-devices <platform>', 'List or remove auto-created persistent devices')
  .option('--apply', 'Actually remove devices (default is dry run)')
  .action(async (platform: string, options: { apply?: boolean }) => {
    const { listAutoCreatedDeviceIds, cleanupAutoCreatedDevices } = await import('../node/device');
    const p = platform as 'ios' | 'android';
    const existing = listAutoCreatedDeviceIds(p);
    if (existing.length === 0) {
      console.log('No auto-created devices found.');
      return;
    }
    if (!options.apply) {
      console.log('Auto-created devices:');
      for (const id of existing) console.log(`  - ${id}`);
      console.log('Run with --apply to delete.');
      return;
    }
    const removed = cleanupAutoCreatedDevices(p);
    console.log(`Removed ${removed.length} device(s).`);
  });

cli.help();
cli.parse();
