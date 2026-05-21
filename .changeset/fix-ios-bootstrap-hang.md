---
"vitest-mobile": patch
---

### fix(harness): prevent bootstrap hang from npx install prompts

Add `--yes` to every `npx` call in the harness builder so npx
auto-confirms package downloads instead of prompting. Under the
spinner, stdin is `'ignore'` — any prompt would hang indefinitely:

- `npx --yes @react-native-community/cli init` (scaffold step, runs
  before the project's `node_modules` exist, so npx always needs to
  resolve the package over the network)
- `npx --yes react-native build-ios` and `npx --yes react-native
  build-android` (build steps; defensive — these usually resolve
  locally after `npm install`)

While here, also switch `buildAndroid` from a raw `gradlew
assembleDebug` to `npx react-native build-android` for symmetry with
iOS and to let the RN CLI handle codegen + Gradle wrapper setup.
Pass `--tasks assembleDebug` explicitly: the CLI defaults its task
prefix to `bundle` (producing an `.aab`), not `assemble` (producing
the `.apk` we need). The `--help` text is misleading on this point.
