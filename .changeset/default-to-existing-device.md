---
"vitest-mobile": patch
---

Default the device picker to an existing simulator/AVD instead of "Create new"

The interactive device picker (used by `bootstrap` and `boot-device`) now
defaults to an existing device rather than prompting to create a dedicated
one. On iOS the pre-selected device is the most recently booted simulator,
matching Expo CLI's heuristic; on Android it's the first available AVD.

"Create new dedicated simulator/AVD" is still available at the bottom of
the list for users who want isolation. The non-interactive (CI) fallback
is unchanged — it still auto-creates a project-scoped device.

This prevents vitest-mobile from stealing Expo CLI's default simulator:
previously, creating and booting a `VitestMobile-*` sim made it macOS
Simulator.app's "most recently used" device, so Expo would target it
on the next `expo start` → `i` press.
