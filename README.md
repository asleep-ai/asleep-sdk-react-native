# react-native-asleep

Advanced sleep tracking SDK for React Native applications, powered by Asleep's AI technology.

## Status

This SDK is under active development. The API may evolve between minor versions until v2.0 — pin to exact versions and review the [CHANGELOG](./CHANGELOG.md) before upgrading.

## Overview

The Asleep SDK for React Native provides comprehensive sleep tracking capabilities using advanced AI algorithms. It can detect sleep patterns, stages, and provide detailed analytics through audio analysis without requiring any wearable devices.

### Key Features

- **Non-invasive Sleep Tracking**: Uses device microphone for sleep analysis
- **Real-time Monitoring**: Live tracking status and progress updates
- **Detailed Sleep Reports**: Comprehensive sleep analysis and metrics
- **Zustand State Management**: Singleton pattern for consistent state across your app
- **Cross-platform Support**: Works on both iOS and Android
- **Event-driven Architecture**: Real-time callbacks for tracking events

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

3. **iOS**: in `ios/`, run `bundle install` (once) then `bundle exec pod install`. The project's `Gemfile` avoids host Ruby/CocoaPods conflicts. **Android**: no extra step.

For permissions, see [Permissions](#2-permissions) below.

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

`RECORD_AUDIO` and `POST_NOTIFICATIONS` are runtime permissions — your app must request them via `PermissionsAndroid` (or equivalent) before starting tracking.

## Usage

### Basic Implementation

```typescript
import React, { useEffect } from "react";
import { useAsleep } from "react-native-asleep";
import { View, Text, Button } from "react-native";

const SleepTracker = () => {
  const {
    userId,
    sessionId,
    isTracking,
    error,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    enableLog,
  } = useAsleep();

  useEffect(() => {
    const initSDK = async () => {
      try {
        // Enable debug logging (optional)
        enableLog(true);

        // Initialize SDK with your API key
        await initAsleepConfig({
          apiKey: "YOUR_API_KEY",
          userId: "optional-user-id", // Optional: SDK generates one if not provided
        });

        console.log("SDK initialized successfully");
      } catch (error) {
        console.error("Failed to initialize SDK:", error);
      }
    };

    initSDK();
  }, []);

  const handleStartTracking = async () => {
    try {
      await startTracking();
      console.log("Sleep tracking started");
    } catch (error) {
      console.error("Failed to start tracking:", error);
    }
  };

  const handleStopTracking = async () => {
    try {
      await stopTracking();
      console.log("Sleep tracking stopped");
    } catch (error) {
      console.error("Failed to stop tracking:", error);
    }
  };

  const handleGetReport = async () => {
    if (!sessionId) return;

    try {
      const report = await getReport(sessionId);
      console.log("Sleep report:", report);
    } catch (error) {
      console.error("Failed to get report:", error);
    }
  };

  return (
    <View>
      <Text>User ID: {userId}</Text>
      <Text>Session ID: {sessionId}</Text>
      <Text>Status: {isTracking ? "Tracking" : "Not Tracking"}</Text>

      <Button
        title="Start Tracking"
        onPress={handleStartTracking}
        disabled={isTracking}
      />
      <Button
        title="Stop Tracking"
        onPress={handleStopTracking}
        disabled={!isTracking}
      />
      <Button
        title="Get Report"
        onPress={handleGetReport}
        disabled={!sessionId}
      />
    </View>
  );
};
```

### Advanced Usage

#### Using AsleepSDK for Non-React Components

For use outside React components or for singleton access:

```typescript
import { AsleepSDK } from "react-native-asleep";

class SleepManager {
  async initializeSDK() {
    try {
      await AsleepSDK.initAsleepConfig({
        apiKey: "YOUR_API_KEY",
      });

      // Initialize event listeners
      AsleepSDK.initialize();

      console.log("SDK initialized");
    } catch (error) {
      console.error("SDK initialization failed:", error);
    }
  }

  async startSleepTracking() {
    await AsleepSDK.startTracking();
  }

  async stopSleepTracking() {
    return await AsleepSDK.stopTracking();
  }

  getCurrentStatus() {
    return {
      isTracking: AsleepSDK.isTracking(),
      userId: AsleepSDK.getUserId(),
      sessionId: AsleepSDK.getSessionId(),
    };
  }
}
```

#### Direct Store Access

```typescript
import { useAsleepStore } from "react-native-asleep";

// Get current state
const currentState = useAsleepStore.getState();

// Subscribe to specific state changes
const unsubscribe = useAsleepStore.subscribe(
  (state) => state.isTracking,
  (isTracking) => {
    console.log("Tracking status changed:", isTracking);
  }
);
```

## API Reference

### useAsleep Hook

Returns an object with the following properties and methods:

#### State Properties

- `userId: string | null` - Current user ID
- `sessionId: string | null` - Current session ID
- `isTracking: boolean` - Whether tracking is active
- `error: string | null` - Last error message
- `didClose: boolean` - Whether the last session was closed
- `log: string` - Latest log message

#### Methods

- `initAsleepConfig(config: AsleepConfig): Promise<void>` - Initialize SDK
- `startTracking(): Promise<void>` - Start sleep tracking
- `stopTracking(): Promise<void>` - Stop sleep tracking
- `getReport(sessionId: string): Promise<AsleepReport | null>` - Get sleep report
- `getReportList(fromDate: string, toDate: string): Promise<AsleepSession[]>` - Get list of reports
- `enableLog(enabled: boolean): void` - Enable/disable debug logging
- `setCustomNotification(title: string, text: string): Promise<void>` - Set custom notification (Android only)

### AsleepConfig

Configuration object for SDK initialization:

```typescript
interface AsleepConfig {
  apiKey: string; // Required: Your API key
  userId?: string; // Optional: User identifier
  baseUrl?: string; // Optional: Custom API base URL
  callbackUrl?: string; // Optional: Webhook callback URL
}
```

### AsleepReport

Sleep analysis report structure:

```typescript
interface AsleepReport {
  sessionId: string;
  sleepEfficiency: number;
  sleepLatency: number;
  sleepTime: number;
  wakeTime: number;
  lightSleepTime: number;
  deepSleepTime: number;
  remSleepTime: number;
  // ... additional metrics
}
```

### AsleepSession

Session information structure:

```typescript
interface AsleepSession {
  sessionId: string;
  startTime: string;
  endTime: string;
  state: string;
  // ... additional session data
}
```

## Event Handling

The SDK automatically handles events through the zustand store. Events are processed internally and state is updated accordingly. You can monitor state changes using useEffect:

```typescript
const { userId, sessionId, isTracking, error } = useAsleep();

useEffect(() => {
  if (error) {
    console.error("SDK Error:", error);
  }
}, [error]);

useEffect(() => {
  if (sessionId) {
    console.log("New session created:", sessionId);
  }
}, [sessionId]);
```

## Best Practices

### 1. SDK Initialization

- Initialize the SDK early in your app lifecycle
- Handle initialization errors gracefully
- Store API key securely (use environment variables)

### 2. Permission Handling

- Request microphone permission before starting tracking
- Provide clear explanation to users about why permission is needed
- Handle permission denial gracefully

### 3. Battery Optimization (Required)

#### Cross-Platform Requirement

**IMPORTANT**: Battery optimization check is required on both iOS and Android platforms. This ensures iOS developers properly handle battery optimization, preventing issues for their Android users in production.

#### Implementation

```typescript
import { AsleepSDK } from 'react-native-asleep';

// Required before starting tracking on BOTH platforms
const batteryStatus = await AsleepSDK.checkBatteryOptimization();

if (!batteryStatus.exempted && Platform.OS === 'android') {
  // Prompt user to disable battery optimization
  Alert.alert(
    'Battery Optimization Required',
    'Sleep tracking requires battery optimization to be disabled for uninterrupted 6-8 hour sessions.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: async () => {
          await AsleepSDK.requestBatteryOptimizationExemption();
        }
      }
    ]
  );
}

// Now safe to start tracking
await AsleepSDK.startTracking();
```

#### Why This Matters

- **Android**: Battery optimization can interrupt long-running sleep tracking sessions
- **iOS**: While not technically needed, the check ensures consistent cross-platform code
- **Developer Experience**: iOS developers testing only on iOS might miss Android requirements
- **User Experience**: Prevents tracking failures for Android users of iOS-developed apps

### 4. Error Handling

- Always wrap SDK calls in try-catch blocks
- Monitor the error state for real-time error updates
- Provide user-friendly error messages

### 5. State Management

- Use the built-in zustand store for consistent state
- Subscribe to specific state changes when needed
- Avoid unnecessary re-renders by selecting specific state slices

## Example App

See the `/example` directory for a complete implementation example.

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure microphone permission is granted
2. **SDK Not Initialized**: Call `initAsleepConfig` before other methods
3. **Network Errors**: Check internet connection and API key validity
4. **Battery Optimization Error**: Call `checkBatteryOptimization()` before `startTracking()` on all platforms
5. **Android Tracking Interrupted**: Ensure battery optimization is disabled via system settings

### Debug Mode

Enable debug logging to see detailed SDK operations:

```typescript
const { enableLog } = useAsleep();
enableLog(true);
```

## License

This project is licensed under the MIT License.

## Support

For issues and support:

- [GitHub Issues](https://github.com/asleep-ai/asleep-sdk-react-native/issues)
- [Asleep Documentation](https://docs.asleep.ai)
- [Asleep Dashboard](https://dashboard.asleep.ai)
