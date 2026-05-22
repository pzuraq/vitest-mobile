---
"vitest-mobile": patch
---

Fix `bootstrap` failing on iOS for projects that depend on `react-native-reanimated@4`. The React Native community CLI's `pod install` step was passing `RCT_NEW_ARCH_ENABLED='0'` on a virgin scaffold because its New Architecture detector relies on a Pods xcodeproj that doesn't exist yet, which Reanimated's podspec asserts against. The harness builder now pre-seeds the file the detector reads, so pod install runs with the New Architecture enabled like the template expects.
