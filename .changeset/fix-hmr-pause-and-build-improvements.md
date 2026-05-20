---
"vitest-mobile": minor
---

Fix component hot reload during `pause()` and improve build robustness.

**HMR fix:** Editing a component file while paused previously triggered a full
app reload instead of a live Fast Refresh update. The root cause was twofold:

1. Components loaded with `__ReactRefresh` disabled had no family registrations,
   so `performReactRefresh()` couldn't map old→new component types.
2. Restoring the real Refresh runtime during pause caused Metro to detect a
   boundary status change ("invalidated boundary") and call
   `performFullRefresh()`.

The fix installs a registration-only shim that builds component families from
initial load (forwarding `register()`) while preventing implicit self-accept
(`isLikelyComponentType()` → false). During pause, `performFullRefresh()` is
suppressed and `performReactRefresh()` is triggered manually.

**Build improvements:**

- Use `npx react-native build-ios` / `build-android` instead of raw
  xcodebuild/gradlew — simplifies the build step and lets RN CLI handle
  pod install, gem setup, and gradle wrapper automatically.
- Detect and recover from stale build locks (killed/interrupted builds no
  longer block subsequent runs indefinitely).
- Clean incomplete binaries and DerivedData before rebuilding.
- Add `--verbose` flag to all CLI commands (streams child-process output
  instead of using a spinner).
