---
"vitest-mobile": patch
---

Fix `bootstrap` failing on iOS for projects that depend on `react-native-reanimated@4`. The React Native community CLI's `--force-pods` path calls `pod install` with `RCT_NEW_ARCH_ENABLED='0'` even when the template defaults the New Architecture to on, which trips Reanimated's podspec assertion. The harness builder now prepends `ENV['RCT_NEW_ARCH_ENABLED'] = '1'` to the scaffolded Podfile so the env is corrected inside the same pod-install process, before any podspecs are evaluated.
