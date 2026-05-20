---
"vitest-mobile": patch
---

Anchor the generated Metro config's `vitest-stubs/` lookup at the active
workspace's `node_modules/vitest-mobile/` instead of the cached harness's.

The cached harness's `node_modules/vitest-mobile` is installed via `file:`,
so npm creates a symlink to whichever workspace first built the cache.
Two workspaces with the same RN version + native modules + vitest-mobile
version share a cache key, and the second one would hit Metro errors like

```
Failed to get the SHA-1 for: <other-workspace>/node_modules/vitest-mobile/src/metro/vitest-stubs/empty.js.
  Potential causes:
    1) The file is not watched. Ensure it is under the configured `projectRoot` or `watchFolders`.
```

— because the symlink target lives outside the second workspace's
`projectRoot` and `watchFolders`, so Metro's file map doesn't track it.

Resolving the stubs from `projectRoot` instead is safe: `computeCacheKey`
already includes the vitest-mobile package version, so the workspace's
stubs are guaranteed to match the harness's on every run. The fix is
template-only — existing cached harness binaries continue to work
unchanged, no rebuild required.

Unblocks running tests from multiple checkouts of the same repo (and
fixes CI tarball-restore scenarios where the originating workspace
isn't present on the runner).
