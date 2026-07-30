# react-native-asleep

[English](./README.md) | [한국어](./README.ko.md)

Sleep tracking for React Native and Expo apps, powered by Asleep's AI technology. The SDK uses the device microphone, requires no wearable, and exposes one React hook plus typed data models for iOS and Android.

> This SDK is under active development. v2 has a deliberately small public surface. Pin exact versions and review the [changelog](./CHANGELOG.md) before upgrading.

## What is included

- Microphone-based sleep tracking and Android service restoration
- Sleep reports, session lists, average reports, and in-progress analysis
- A shared state model across iOS and Android
- Structured `AsleepError` values with recovery categories
- `useAsleep()` for React and a small `Asleep` API for non-React code

## Requirements

| Component | Minimum |
|---|---|
| React Native | 0.74 |
| React | 18.2 |
| iOS deployment target | 14.0 |
| Android `minSdkVersion` | 24 |

The example app is currently verified with React Native 0.79.2, Expo 53, React 19.0.0, and Android compile/target SDK 34.

Bundled native SDK versions:

| Platform | Native SDK version |
|---|---|
| iOS | 3.2.0 |
| Android | 3.2.1 |

## Installation

### Expo projects

```bash
expo install react-native-asleep
```

This package contains native modules, so create a new development or store build after installing or upgrading it. It does not run in Expo Go and cannot be upgraded through an OTA update alone.

### Bare React Native projects

This library uses the Expo Modules API. Install Expo modules once if the app does not already use them:

```bash
npx install-expo-modules@latest
npm install react-native-asleep
```

Then install iOS pods:

```bash
cd ios
bundle install
bundle exec pod install
```

Android needs no additional linking step.

#### Static frameworks

The iOS pod is a static framework. Do not add `use_frameworks!` only for this package. If the app already requires it, use static linkage:

```ruby
use_frameworks! :linkage => :static
```

Dynamic linkage is known to break Expo SDK 55 builds; see [expo/expo#44487](https://github.com/expo/expo/issues/44487) and [expo/expo#41556](https://github.com/expo/expo/issues/41556).

#### Monorepos and workspaces

If `react-native-asleep` is hoisted to a parent `node_modules`, configure Expo autolinking in the app's `package.json`:

```json
{
  "expo": {
    "autolinking": {
      "nativeModulesDir": ".."
    }
  }
}
```

## Native configuration

Create an API key in the [Asleep Dashboard](https://dashboard.asleep.ai).

### iOS

Your app must declare microphone usage and background audio.

For Expo projects:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "This app uses the microphone for sleep tracking.",
        "UIBackgroundModes": ["audio"]
      }
    }
  }
}
```

For bare React Native projects, add the equivalent entries to the app's `Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app uses the microphone for sleep tracking.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

### Android

The library declares its required permissions and foreground service in its manifest. The manifest merger adds them to the app, so do not duplicate them only for this SDK.

`RECORD_AUDIO` is required at runtime. On Android 13 and later, `requestRequiredPermissions()` also requests `POST_NOTIFICATIONS` so the foreground-service notification can remain visible, but notification denial does not make its return value `false`.

## Quick Start

The required startup order is:

```text
check for an existing Android tracking service
→ initialize the SDK configuration
→ check battery optimization
→ request permissions from a user action
→ start tracking
```

Always call `initAsleepConfig()` after `checkAndRestoreTracking()`, including when an Android service session was restored. On iOS, the restoration check is a required cross-platform prerequisite but reports no persistent service.

```tsx
import { useEffect, useRef, useState } from "react";
import { Button, Platform, Text, View } from "react-native";
import { AsleepError, useAsleep } from "react-native-asleep";

export function SleepTracker() {
  const asleep = useAsleep();
  const hasBootstrapped = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;

    async function bootstrap() {
      await asleep.checkAndRestoreTracking();

      const config = { apiKey: "YOUR_API_KEY" };
      if (Platform.OS === "ios") {
        let removeJoined = () => {};
        let removeFailed = () => {};
        const configurationFinished = new Promise<void>((resolve, reject) => {
          removeJoined = asleep.addEventListener("onUserJoined", () => resolve());
          removeFailed = asleep.addEventListener("onUserJoinFailed", (failure) => {
            reject(
              new AsleepError(
                "USER_JOIN_FAILED",
                failure.detail ?? failure.error ?? "User join failed.",
                {
                  sdkCode: failure.sdkCode,
                  caseName: failure.caseName,
                  cause: failure,
                },
              ),
            );
          });
        });

        try {
          await Promise.all([
            asleep.initAsleepConfig(config),
            configurationFinished,
          ]);
        } finally {
          removeJoined();
          removeFailed();
        }
      } else {
        await asleep.initAsleepConfig(config);
      }

      await asleep.checkBatteryOptimization();
      setIsReady(true);
    }

    void bootstrap().catch((cause: unknown) => {
      setBootstrapMessage(cause instanceof Error ? cause.message : String(cause));
    });
  }, [
    asleep.checkAndRestoreTracking,
    asleep.initAsleepConfig,
    asleep.addEventListener,
    asleep.checkBatteryOptimization,
  ]);

  async function start() {
    try {
      if (!(await asleep.hasRequiredPermissions())) {
        const granted = await asleep.requestRequiredPermissions();
        if (!granted) return;
      }

      const battery = await asleep.checkBatteryOptimization();
      if (!battery.exempted) {
        await asleep.requestBatteryOptimizationExemption();
        return; // Check again after the user returns from Android settings.
      }

      await asleep.startTracking({
        android: {
          notification: {
            title: "Sleep tracking",
            text: "Sleep analysis is running.",
          },
        },
      });
    } catch (cause: unknown) {
      if (!(cause instanceof AsleepError)) throw cause;
      // The same AsleepError is also available reactively as asleep.error.
    }
  }

  async function stop() {
    try {
      await asleep.stopTracking();
    } catch (cause: unknown) {
      if (!(cause instanceof AsleepError)) throw cause;
    }
  }

  const shouldStop =
    asleep.isTracking || asleep.error?.category === "recordingDead";

  return (
    <View>
      <Text>Status: {asleep.status}</Text>
      {bootstrapMessage ? <Text>{bootstrapMessage}</Text> : null}
      {asleep.error ? <Text>{asleep.error.message}</Text> : null}
      <Button
        title={shouldStop ? "Stop tracking" : "Start tracking"}
        disabled={!isReady}
        onPress={shouldStop ? stop : start}
      />
    </View>
  );
}
```

Call `requestRequiredPermissions()` from a user-driven interaction. `startTracking()` checks permission but never opens a permission dialog. On Android, return from the battery settings screen and call `checkBatteryOptimization()` again before retrying.

On iOS, `initAsleepConfig()` starts asynchronous user configuration but its bridge call can return before the native managers are ready. Register the user events before calling it and wait for `onUserJoined` or `onUserJoinFailed`, as shown above. Android resolves `initAsleepConfig()` after configuration; do not wait for `onUserJoined` there because a restored-service fast path does not emit it.

The `recordingDead` category is another deliberate exception: `isTracking` is `false`, but the native session remains open, so the action must still call `stopTracking()` before starting a new session.

For ODA (On-Device Analysis), `setup()` is the configuration entry point for a new ODA session. This Quick Start documents service mode; `setup()` cannot run while a restored session is tracking.

## Core API

```ts
import {
  Asleep,
  AsleepError,
  useAsleep,
  type AsleepReport,
  type AsleepSession,
  type TrackingStatus,
} from "react-native-asleep";
```

### `useAsleep()`

The primary React API. It attaches the ref-counted native listeners while mounted and returns state plus actions from the shared SDK store.

Important state:

| Field | Meaning |
|---|---|
| `status` | `"idle"`, `"tracking"`, `"paused"`, or `"recoveryRequired"` |
| `isTracking` | `true` for every status except `"idle"` |
| `isTrackingPaused` | The native session is temporarily interrupted |
| `isRecoveryRequired` | iOS needs an explicit foreground `resumeTracking()` |
| `isSetupComplete` | SDK configuration completed |
| `sessionId`, `userId` | Current native identifiers |
| `analysisResult`, `isAnalyzing` | Latest analysis event and request state |
| `error` | The latest `AsleepError`, or `null` |

Important actions:

| Area | Actions |
|---|---|
| Configuration and restore | `setup`, `initAsleepConfig`, `checkAndRestoreTracking` |
| Prerequisites | `checkBatteryOptimization`, `requestBatteryOptimizationExemption`, `hasRequiredPermissions`, `requestRequiredPermissions` |
| Tracking | `startTracking`, `stopTracking`, `resumeTracking` |
| Reports | `getReport`, `getReportList`, `getAverageReport`, `deleteSession` |
| Analysis | `requestAnalysis` |
| Utilities | `addEventListener`, `enableLog`, `clearError` |

### `Asleep`

Use the imperative escape hatch where React hooks are unavailable:

```ts
import { Asleep } from "react-native-asleep";

const releaseListeners = Asleep.initialize();
const unsubscribe = Asleep.subscribe((state) => {
  console.log(state.status, state.error?.code);
});

console.log(Asleep.getState().status);

unsubscribe();
releaseListeners();
```

`Asleep.initialize()` is ref-counted and must be paired with its returned cleanup function. Importing the package alone does not attach native listeners.

### Errors

Every failed action throws `AsleepError`; the same error is stored in `useAsleep().error` when applicable.

```ts
try {
  await asleep.startTracking();
} catch (cause: unknown) {
  if (cause instanceof AsleepError) {
    console.log(cause.code, cause.category, cause.sdkCode);
  }
}
```

Use `code` for stable machine branching and `message` for display. Runtime tracking failures can also have one of these recovery categories:

| Category | Meaning |
|---|---|
| `terminal` | The native session is already gone |
| `recordingDead` | Recording stopped but the native session remains open |
| `recoveryRequired` | The live iOS session needs a foreground resume |
| `transient` | The native session survived the failure |
| `unknown` | The failure is not classified; do not assume it is recoverable |

See the integration guide for the required action for each category.

## Production integration

The README covers installation and the first successful tracking flow. Before shipping, read the [Integration Guide](./docs/INTEGRATION.md) for:

- cold-start restoration and listener ownership
- app-owned versus SDK-owned state
- Android foreground-service and battery behavior
- iOS interruption recovery
- recovery-category handling
- analysis and report timing
- real-device release checks

## Migrating from 1.x

v2 removes the parallel and mutable v1 surfaces:

| 1.x | v2 |
|---|---|
| `error: string \| null` and `errorInfo` | One `AsleepError`; use `message`, `code`, `category`, and `sdkCode` |
| Report failures returned `null` or `[]` | Report APIs throw `AsleepError`; an empty report list remains a valid result |
| Public state setters and raw store | Native events and SDK actions are the only writers |
| `getTrackingDurationMinutes()` | Store a wall-clock start time in the app |
| `requestMicrophonePermission()` | `requestRequiredPermissions()` |
| `startTracking()` requested permission | Check and request permission explicitly before starting |
| Default export, `AsleepSDK`, and `Asleep` class | `useAsleep()` and the named thin `Asleep` escape hatch |
| Required `zustand` dependency | No external state-library dependency |

Android 13 and later still request notification permission, but `requestRequiredPermissions()` now returns the microphone-side result that determines whether tracking can start. Pin the new version, update all imports and error branches, and test cold-start permissions before release.

## Example app

See the [example app on GitHub](https://github.com/asleep-ai/asleep-sdk-react-native/tree/main/example) for a runnable implementation.

## License

See [LICENSE.md](./LICENSE.md).

## Support

- [GitHub Issues](https://github.com/asleep-ai/asleep-sdk-react-native/issues)
- [Asleep Documentation](https://docs.asleep.ai)
- [Asleep Dashboard](https://dashboard.asleep.ai)
