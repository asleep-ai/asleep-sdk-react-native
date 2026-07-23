# react-native-asleep

Advanced sleep tracking SDK for React Native applications, powered by Asleep's AI technology.

## Status

This SDK is under active development. v2 has a deliberately small public surface; pin to exact versions and review the [CHANGELOG](./CHANGELOG.md) before upgrading.

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
   npm install react-native-asleep
   ```

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

#### Bundled native SDK versions

| Platform | Native SDK version |
|---|---|
| iOS | 3.2.0 |
| Android | 3.2.1 |

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
import { Button, Text, View } from "react-native";
import { AsleepError, useAsleep } from "react-native-asleep";

function SleepTracker() {
  const {
    status,
    isTracking,
    error,
    initAsleepConfig,
    checkAndRestoreTracking,
    checkBatteryOptimization,
    hasRequiredPermissions,
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
    try {
      if (!(await hasRequiredPermissions())) {
        const granted = await requestRequiredPermissions();
        if (!granted) return;
      }

      await startTracking({
        android: { notification: { title: "Sleep tracking", text: "Recording..." } },
      });
    } catch (cause) {
      if (!(cause instanceof AsleepError)) throw cause;
      // `error` is also updated reactively and rendered below.
    }
  };

  return (
    <View>
      <Text>Status: {status}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button title={isTracking ? "Stop" : "Start"} onPress={isTracking ? stopTracking : handleStart} />
    </View>
  );
}
```

For ODA (On-Device Analysis) mode, call `setup()` instead of `initAsleepConfig()`. See [`example/App.tsx`](./example/App.tsx) for the full flow including report fetch and event-driven state.

## API surface

The v2 API has one reactive hook, one thin imperative escape hatch, and named value/type exports:

```ts
import {
  Asleep,
  AsleepError,
  useAsleep,
  type AsleepAverageReport,
  type AsleepReport,
  type AsleepSession,
  type TrackingStatus,
} from "react-native-asleep";
```

`useAsleep()` attaches the native listeners while mounted and returns the public state plus bound actions.

### Public state

The store keeps native facts internally and derives the public booleans from `status`:

| Field | Meaning |
|---|---|
| `status` | `"idle"`, `"tracking"`, `"paused"`, or `"recoveryRequired"` |
| `isTracking` | `true` for every status except `"idle"`; recovery-required sessions are still live |
| `isTrackingPaused` | `true` only while `status` is `"paused"` |
| `isRecoveryRequired` | `true` only while `status` is `"recoveryRequired"` |
| `isSetupInProgress` / `isSetupComplete` | Derived setup lifecycle |
| `sessionId` / `userId` | Current native identifiers |
| `error` | Last `AsleepError`, or `null` |
| `analysisResult` / `isAnalyzing` | Latest analysis event and request state |
| `didClose` / `isODAEnabled` / `log` | Session history, mode, and opt-in debug log |

`trackingStartTime`, listener bookkeeping, and mutable setters are internal implementation details.

### Actions

The hook exposes:

- Setup and restore: `setup`, `initAsleepConfig`, `checkAndRestoreTracking`
- Tracking: `startTracking`, `stopTracking`, `resumeTracking`
- Reports: `getReport`, `getReportList`, `getAverageReport`, `deleteSession`, `requestAnalysis`
- Prerequisites: `checkBatteryOptimization`, `requestBatteryOptimizationExemption`, `hasRequiredPermissions`, `requestRequiredPermissions`
- Utilities: `enableLog`, `clearError`, `addEventListener`, and the deprecated no-op `setCustomNotification`

`requestAnalysis()` returns the Android analysis result or the iOS `{ status: "requested", timestamp }` acknowledgement. On both platforms, `onAnalysisResult` is the only writer of reactive `analysisResult`.

### Non-React contexts

Use `Asleep` for background callbacks and other code where hooks are unavailable:

```ts
import { Asleep } from "react-native-asleep";

// Required when no mounted useAsleep() hook owns the native listener lifecycle.
const teardown = Asleep.initialize();

const unsubscribe = Asleep.subscribe(({ status, error }) => {
  console.log(status, error?.code);
});

const offAnalysis = Asleep.addEventListener("onAnalysisResult", (result) => {
  console.log(result);
});

await Asleep.getState().stopTracking();

offAnalysis();
unsubscribe();
teardown();
```

`initialize()` is ref-counted, so it is safe to use alongside mounted hooks. Importing the package alone does not attach native listeners.

On iOS, `isRecoveryRequired` becomes `true` when recording cannot resume while the app is in the background. After the app returns to the foreground, call `resumeTracking()`. The flag clears only after the next successful audio upload. `resumeTracking()` is iOS-only and rejects with `UNSUPPORTED_PLATFORM` on Android.

## Tracking lifecycle and platform compensations

The library handles a number of platform quirks internally so JS sees a consistent event model:

- iOS 3.2.1 `closeSessionSilently()` on 403/429 tears down a session without firing `didClose` — the wrapper detects terminal error codes and resets `isTracking` / `isAnalyzing` itself.
- Android SDK 3.2.x emits both `onFail` and `onFinish` for fatal codes — the wrapper suppresses the spurious `onTrackingClosed` so JS doesn't misread a fatal error as a clean close.
- iOS interruption recovery may emit duplicate `didResume` events — the wrapper deduplicates while still clearing `error`.
- iOS audio initialization failure stops recording without closing the native session — stop and restart the session; `resumeTracking()` cannot recover it.

See [AGENTS.md](./AGENTS.md#native-behavior-compensations) for the full table including upstream SDK versions and rationale.

## Error classification

Every failed action and native failure event produces an `AsleepError`, which extends `Error`:

```ts
class AsleepError extends Error {
  readonly code: string;
  readonly category?: "terminal" | "recordingDead" | "recoveryRequired" | "transient" | "unknown";
  readonly sdkCode?: number;
  readonly caseName?: string;
  readonly cause?: unknown;
}
```

Branch on the stable `code`, render `message`, and forward the error itself to observability tooling. Tracking failures also carry the library's objective recovery classification in `category`; the app decides what severity to record:

| `category` | Meaning | Suggested app-side severity |
|---|---|---|
| `terminal` | Native session is gone; no `onTrackingClosed` will follow. Start a new session. | error |
| `recordingDead` | Recorder torn down but the session is still open; `stopTracking()` then start again. | error |
| `recoveryRequired` | Tracking is alive; call `resumeTracking()` in the foreground (`isRecoveryRequired` is also set). | warning |
| `transient` | The native session survived (e.g. one upload window failed after internal retries); later uploads continue. | warning |
| `unknown` | Unclassified code — do not assume it is benign. | error |

```ts
const { error } = useAsleep();

useEffect(() => {
  if (!error) return;
  if (error.category === "recoveryRequired" || error.category === "transient") {
    analytics.track("asleep_recoverable_error", {
      code: error.code,
      sdkCode: error.sdkCode,
      category: error.category,
    });
  } else {
    Sentry.captureException(error);
  }
}, [error]);
```

`sdkCode` is the numeric code documented by the native Asleep SDKs. The legacy `errorCode` event-payload field remains for wire compatibility but is deprecated: on iOS it is a Swift enum ordinal from NSError bridging, not the documented code.

All actions, including report queries, throw `AsleepError` on failure. Queries no longer return `null` or `[]` as failure sentinels. Successful actions clear only the error that was present when the native call began; a classified failure event arriving during the await is preserved.

## Best practices

- **Permission flow**: use `hasRequiredPermissions()` for a non-interactive check, then call `requestRequiredPermissions()` from a user-initiated flow. `startTracking()` never opens a permission dialog and throws `PERMISSION_DENIED` when permission is missing.
- **Battery optimization (Android, required)**: long sessions get killed without an exemption. Call `checkBatteryOptimization()` before `startTracking()`; if not exempted, call `requestBatteryOptimizationExemption()` and follow the system prompt. iOS's no-op call keeps cross-platform code uniform.
- **Error handling**: gate log severity on `useAsleep().error?.category` and switch on `error.code` for category-specific UI rather than parsing message text.
- **Non-React lifecycle**: pair every `Asleep.initialize()` with its returned teardown function.

## Migrating from 1.x

v2 deliberately removes the parallel and mutable v1 surfaces:

1. `error: string | null` is now `AsleepError | null`. Render `error?.message` and branch on `error?.code`.
2. `errorInfo` is removed. Read `error.category`, `error.sdkCode`, and `error.caseName`.
3. Report and analysis queries throw `AsleepError` on failure instead of returning `null` or `[]`.
4. Public state setters are removed. Native events and SDK actions are the sole state writers; `clearError()` remains public.
5. `getTrackingDurationMinutes()` is removed and `trackingStartTime` is internal. Apps own wall-clock duration.
6. `requestMicrophonePermission()` is removed. Use `requestRequiredPermissions()`.
7. `startTracking()` no longer requests permission. Check with `hasRequiredPermissions()`, explicitly request if needed, then start.
8. The default export, `Asleep` class, `AsleepSDK`, and raw `asleepStore` export are removed. Use `useAsleep()` or the named `Asleep` escape hatch.
9. `zustand` is no longer a dependency. Remove it from your app if nothing else uses it.
10. Use the additive `status: TrackingStatus` field when a single lifecycle value is clearer than multiple derived booleans.
11. Android 13+: `requestRequiredPermissions()` still requests `POST_NOTIFICATIONS` (so the foreground-service notification stays visible), but its return value now reflects only what tracking needs to run — microphone-side permissions, matching `hasRequiredPermissions()`. In 1.x a denied notification permission made it return `false` even though tracking could start.

## Troubleshooting

- **`PERMISSION_DENIED` from `startTracking`**: check and request microphone permission from a user-initiated flow, then retry.
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
