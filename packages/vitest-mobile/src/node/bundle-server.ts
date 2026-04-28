/**
 * Static HTTP server for pre-built Metro bundles.
 *
 * When a user runs `vitest-mobile bundle` ahead of time, the resulting
 * bundle + sourcemap + manifest are served from a plain http.Server at the
 * same port Metro would have used. This lets the RN app treat the two
 * interchangeably, avoiding a full Metro spin-up when the bundle is
 * already built.
 */

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger';
import type { MetroServer, BundleManifest } from './metro-runner';
import type { InternalPoolOptions, ResolvedNativePluginOptions } from './types';

/**
 * Look up a pre-built bundle for this pool run. Returns `null` when the
 * user didn't request a pre-built bundle, or when no manifest/bundle file
 * matches. The `options.metro.bundle` field drives behavior:
 *
 * - falsy → pool uses Metro directly; `null` returned.
 * - `true` → bundle expected at `<internal.appDir>/.vitest-mobile/bundle`.
 * - string → bundle expected at that path (absolute or relative to cwd).
 */
export function detectPrebuiltBundle(
  options: Pick<ResolvedNativePluginOptions, 'platform' | 'metro'>,
  internal: Pick<InternalPoolOptions, 'appDir'>,
): (BundleManifest & { bundleDir: string }) | null {
  const bundleOpt = options.metro.bundle;
  if (!bundleOpt) return null;

  const searchRoot = typeof bundleOpt === 'string' ? resolve(bundleOpt) : internal.appDir;
  const bundleDir = resolve(searchRoot, '.vitest-mobile', 'bundle');
  const manifestPath = resolve(bundleDir, 'bundle-manifest.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest: BundleManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.bundles[options.platform];
    if (!entry) return null;
    const bundlePath = resolve(bundleDir, entry.bundleFile);
    if (!existsSync(bundlePath)) return null;
    return { ...manifest, bundleDir };
  } catch {
    return null;
  }
}

/**
 * Start a plain HTTP server that serves a pre-built bundle on the port the
 * manifest recorded. Pass the prebuilt result directly from
 * {@link detectPrebuiltBundle}.
 */
export function startStaticBundleServer(
  prebuilt: BundleManifest & { bundleDir: string },
  platform: string,
): Promise<MetroServer> {
  const { bundleDir } = prebuilt;
  const manifest = prebuilt;
  const entry = manifest.bundles[platform]!;
  const bundlePath = resolve(bundleDir, entry.bundleFile);
  const sourcemapPath = resolve(bundleDir, entry.sourcemapFile);
  const bundleContent = readFileSync(bundlePath);
  const sourcemapContent = existsSync(sourcemapPath) ? readFileSync(sourcemapPath) : null;

  return new Promise((resolveServer, reject) => {
    const server = createHttpServer((req, res) => {
      const url = req.url ?? '';

      if (url === '/status') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('packager-status:running');
        return;
      }

      if (url.includes('.bundle') || url.includes('.js')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(bundleContent);
        return;
      }

      if (url.endsWith('.map') && sourcemapContent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(sourcemapContent);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.on('error', reject);
    server.listen(manifest.metroPort, '127.0.0.1', () => {
      (server as HttpServer & { unref?: () => void }).unref?.();
      log.info(`Static bundle server on port ${manifest.metroPort} (pre-built)`);
      resolveServer({
        port: manifest.metroPort,
        async close() {
          await new Promise<void>(r => {
            server.close(() => r());
            setTimeout(r, 1000);
          });
        },
      });
    });
  });
}
