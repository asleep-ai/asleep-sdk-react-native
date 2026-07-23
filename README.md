# react-native-asleep

Advanced sleep tracking SDK for React Native applications, powered by Asleep's AI technology.

## Status

This SDK is under active development. The API may evolve between minor versions until v2.0 — pin to exact versions and review the [CHANGELOG](./CHANGELOG.md) before upgrading.

## Overview

Non-invasive sleep tracking via the device microphone — no wearables required. Detects sleep stages and produces detailed reports. Works on iOS and Android, exposes a single React hook plus typed data models.

## Installation

### For Expo Managed Projects

```bash
expo install react-native-asleep
```

### For Bare React Native Projects

This library uses the Expo Modules API. Bare RN projects need Expo modules installed once; after that, autolinking handles the rest — no `react-native.config.js` or manual native linking.

1. **Install Expo modules** (skip if already installed):

   ```bash
   npx install-expo-modules@latest
   ```

   It prompts `Install the Expo CLI integration? (Y/n)` — either answer wires the bare modules. See the [Expo bare guide](https://docs.expo.dev/bare/installing-expo-modules/) for details.

2. **Install the package** (`npm install` / `pnpm add` / `yarn add`):

   ```bash
   npm install react-native-asleep zustand
   ```

   `zustand` is a peer dependency through v1.x and will be removed in v2.0.

3. **iOS**: in `ios/`, run `bundle install` (once) then `bundle exec pod install`. The project's `Gemfile` avoids host Ruby/CocoaPods conflicts. **Android**: no extra step.

#### Static framework note

The iOS podspec sets `s.static_framework = true`. **Do not add `use_frameworks!` to your `Podfile`.** If your project already requires it, pin to static linkage:

```ruby
use_frameworks! :linkage => :static
```

`:linkage => :dynamic` is known to break Expo SDK 55 builds (see [expo/expo#44487](https://github.com/expo/expo/issues/44487), [#41556](https://github.com/expo/expo/issues/41556)).

#### Monorepo / workspace projects

If `react-native-asleep` is hoisted to a parent `node_modules`, configure autolinking in your app's `package.json`:

```json
{
  "expo": {
    "autolinking": {
      "nativeModulesDir": ".."
    }
  }
}
```

#### Reference configuration

The [example app](./example) is the reference setup. Adjacent versions are expected to work but aren't verified.

| Component                   | Version  |
| --------------------------- | -------- |
| React Native                | 0.79.2   |
| Expo                        | 53       |
| React                       | 19.0.0   |
| iOS deployment target       | 14.0     |
| Android `minSdkVersion`     | 24       |
| Android `compileSdkVersion` | 34       |
| Android `targetSdkVersion`  | 34       |

## Setup

### 1. Get API Key

1. Visit [Asleep Dashboard](https://dashboard.asleep.ai)
2. Create an account and generate your API key
3. Note your API key for configuration

### 2. Permissions

#### iOS — declared by your app

Add the microphone usage description and audio background mode.

**For Expo Managed Projects (app.json):**

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "This app needs microphone access for sleep tracking",
        "UIBackgroundModes": ["audio"]
      }
    }
  }
}
```

**For Bare React Native Projects (ios/YourApp/Info.plist):**

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for sleep tracking</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

#### Android — declared by the library

The library declares its own permissions; the manifest merger combines them into your app. No `<uses-permission>` entries are needed in your `AndroidManifest.xml`. For reference, the library declares:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
```

`RECORD_AUDIO` and `POST_NOTIFICATIONS` are runtime permissions — request them via `useAsleep().requestRequiredPermissions()` (or `PermissionsAndroid`) before starting tracking.

## Quick Start

```tsx
import { useEffect } from "react";
import { Button, View } from "react-native";
import { useAsleep } from "react-native-asleep";

function SleepTracker() {
  const {
    isTracking,
    sessionId,
    error,
    initAsleepConfig,
    checkAndRestoreTracking,
    checkBatteryOptimization,
    requestRequiredPermissions,
    startTracking,
    stopTracking,
  } = useAsleep();

  // Required order before startTracking: configure -> restore any in-progress session -> battery check
  useEffect(() => {
    (async () => {
      await initAsleepConfig({ apiKey: "YOUR_API_KEY" });
      await checkAndRestoreTracking();
      await checkBatteryOptimization();
    })();
  }, []);

  const handleStart = async () => {
    await requestRequiredPermissions();
    await startTracking({
      android: { notification: { title: "Sleep tracking", text: "Recording..." } },
    });
  };

  return (
    <View>
      <Button title={isTracking ? "Stop" : "Start"} onPress={isTracking ? stopTracking : handleStart} />
    </View>
  );
}
```

For ODA (On-Device Analysis) mode, call `setup()` instead of `initAsleepConfig()`. See [`example/App.tsx`](./example/App.tsx) for the full flow including report fetch and event-driven state.

## API surface

The library exports a single React hook plus types:

```ts
import { useAsleep, type AsleepReport, type AsleepSession, type AsleepAverageReport } from "react-native-asleep";
```

`useAsleep()` returns reactive state (`isTracking`, `sessionId`, `error`, `analysisResult`, ...) and bound actions (`startTracking`, `stopTracking`, `getReport`, `getReportList`, `requestAnalysis`, ...). Hover the return type in your editor for the full surface; the type definitions in [`src/Asleep.types.ts`](./src/Asleep.types.ts) are the source of truth and stay in sync with the native modules.

On iOS, `isRecoveryRequired` becomes `true` when recording cannot resume while the app is in the background. After the app returns to the foreground, call `resumeTracking()`. The flag clears only after the next successful audio upload. `resumeTracking()` is iOS-only and rejects with `UNSUPPORTED_PLATFORM` on Android.

## Tracking lifecycle and platform compensations

The library handles a number of platform quirks internally so JS sees a consistent event model:

- iOS 3.2.1 `closeSessionSilently()` on 403/429 tears down a session without firing `didClose` — the wrapper detects terminal error codes and resets `isTracking` / `isAnalyzing` itself.
- Android SDK 3.2.x emits both `onFail` and `onFinish` for fatal codes — the wrapper suppresses the spurious `onTrackingClosed` so JS doesn't misread a fatal error as a clean close.
- iOS interruption recovery may emit duplicate `didResume` events — the wrapper deduplicates while still clearing `error`.
- iOS audio initialization failure stops recording without closing the native session — stop and restart the session; `resumeTracking()` cannot recover it.

See [AGENTS.md](./AGENTS.md#native-behavior-compensations) for the full table including upstream SDK versions and rationale.

## Error classification

`useAsleep().errorInfo` is a structured view of the last tracking failure. Its `category` field is the library's objective verdict on recoverability; the app decides what severity to log at:

| `category` | Meaning | Suggested app-side severity |
|---|---|---|
| `terminal` | Native session is gone; no `onTrackingClosed` will follow. Start a new session. | error |
| `recordingDead` | Recorder torn down but the session is still open; `stopTracking()` then start again. | error |
| `recoveryRequired` | Tracking is alive; call `resumeTracking()` in the foreground (`isRecoveryRequired` is also set). | warning |
| `transient` | The native session survived (e.g. one upload window failed after internal retries); later uploads continue. | warning |
| `unknown` | Unclassified code — do not assume it is benign. | error |

```ts
const { errorInfo } = useAsleep();

useEffect(() => {
  if (!errorInfo) return;
  if (errorInfo.category === "recoveryRequired" || errorInfo.category === "transient") {
    analytics.track("asleep_recoverable_error", errorInfo); // visibility without paging
  } else {
    Sentry.captureException(new Error(`[Asleep] ${errorInfo.code}`), { extra: errorInfo });
  }
}, [errorInfo]);
```

`errorInfo.sdkCode` carries the numeric error code documented by the native Asleep SDKs (both platforms). The legacy `errorCode` event-payload field is deprecated: on iOS it holds a Swift enum ordinal from NSError bridging, not the documented code.

## Best practices

- **Permission flow**: call `requestRequiredPermissions()` *before* `startTracking()`. As of v1.0.18 the Android native module rejects `startTracking` with `PERMISSION_REQUIRED` when `RECORD_AUDIO` / `FOREGROUND_SERVICE_MICROPHONE` aren't granted.
- **Battery optimization (Android, required)**: long sessions get killed without an exemption. Call `checkBatteryOptimization()` before `startTracking()`; if not exempted, call `requestBatteryOptimizationExemption()` and follow the system prompt. iOS's no-op call keeps cross-platform code uniform.
- **Error handling**: gate log severity on `useAsleep().errorInfo?.category` (see [Error classification](#error-classification)) and switch on `errorInfo.code` for category-specific UI rather than parsing `message` substrings.

## Troubleshooting

- **`PERMISSION_REQUIRED` from `startTracking`**: call `requestRequiredPermissions()` first, then retry.
- **`MISSING_PREREQUISITE` from `startTracking`**: call `checkAndRestoreTracking()` and `checkBatteryOptimization()` before `startTracking()`.
- **Tracking ends unexpectedly on Android**: battery optimization is on; call `checkBatteryOptimization()` and follow the prompt.
- **Network errors**: verify API key and connectivity.

Enable debug logs with `useAsleep().enableLog(true)`.

## Example app

See [`example/`](./example) for a full implementation.

## License

MIT.

## Support

- [GitHub Issues](https://github.com/asleep-ai/asleep-sdk-react-native/issues)
- [Asleep Documentation](https://docs.asleep.ai)
- [Asleep Dashboard](https://dashboard.asleep.ai)
