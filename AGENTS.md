# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React Native SDK for Asleep's AI-powered sleep tracking technology. This SDK provides non-invasive sleep tracking through audio analysis without requiring wearable devices.

## Development Commands

### Building and Testing
```bash
# Build the SDK
pnpm build

# Clean build artifacts
pnpm clean

# Run linting
pnpm lint

# Run tests
pnpm test

# Prepare the module
pnpm prepare
```

### Example App Commands
```bash
# In the example directory
pnpm start        # Start Expo development server
pnpm android      # Run on Android
pnpm ios          # Run on iOS
```

### Publishing and Release
```bash
# Manual release via GitHub Actions
# Go to Actions > Release > Run workflow

# Automatic semantic release
pnpm semantic-release
```

## Architecture

### Core Components

1. **Native Modules** (`ios/AsleepModule.swift`, `android/.../AsleepModule.kt`)
   - Platform-specific implementations wrapping native Asleep SDKs
   - Handle audio recording, permission management, and sleep tracking
   - iOS SDK version: 3.2.0, Android SDK version: 3.2.0

2. **State Management** (`src/AsleepStore.ts`)
   - Zustand store with singleton pattern for consistent state across app
   - Handles all SDK state including tracking status, session management, and error handling
   - Provides event listener initialization and cleanup

3. **API Surface** (`src/index.ts`) — currently 4 parallel surfaces, being consolidated in v2.0 (see #47):
   - `useAsleep` hook — primary surface for React components (the only one consumers actually use; see Library Boundary Principles below)
   - `AsleepSDK` singleton — dead code in practice, slated for removal
   - default `asleep` class instance — has bugs (bypasses zustand store), slated for removal
   - `asleepStore` raw zustand — leaks implementation detail, slated for removal

4. **Type Definitions** (`src/Asleep.types.ts`)
   - TypeScript interfaces for all API responses and configurations
   - Comprehensive sleep report and session structures

### Key Features

- **Setup Methods**: Two initialization approaches - `setup()` for ODA (On-Device Analysis) and `initAsleepConfig()` for standard mode
- **Real-time Tracking**: Start/stop tracking lifecycle
- **Report Generation**: Fetch detailed sleep analysis reports with comprehensive metrics
- **Event System**: Automatic event handling through EventEmitter with state synchronization
- **Platform Differences**:
  - Android: Returns analysis results immediately from `requestAnalysis()`
  - iOS: Returns acknowledgment only, results come via `onAnalysisResult` event

### Native Integration Points

- **iOS**: Swift module using Expo modules, requires audio background mode
- **Android**: Kotlin module with foreground service for long-running tracking
- **Permissions**: Microphone access required on both platforms, battery optimization exemption recommended on Android

## Library Boundary Principles

This is a **primitive SDK library**, not a sleep-tracking framework. Apps build products on top of it. The boundary is strict — when in doubt, push concerns OUT of the library.

### What this library owns

- Native module bridge (iOS Swift / Android Kotlin → JS)
- SDK lifecycle: `setup`, `initAsleepConfig`, `startTracking`, `stopTracking`, `checkAndRestoreTracking`
- State synchronization between native and JS (via internal zustand store)
- Raw data exposure: `sessionId`, `analysisResult`, `AsleepReport`, `AsleepSession`, `AsleepAverageReport`
- Permission *methods* (check + request as separate operations)
- Background lifecycle plumbing (Android foreground service, iOS background audio mode)
- Stable hook API (`useAsleep`) + a thin escape hatch for non-React contexts
- Type definitions for the data model

### What apps own (do NOT absorb into the library)

- Business workflow: when to start/stop tracking, alarm coordination, retry policy
- Authentication / cloud sync (Amplify, Firebase, custom backend)
- UI/UX: alerts, modals, permission-denied screens, error toasts
- Domain calculations beyond raw SDK output: timeline slot generation, sleep-stage text labels, custom metric aggregations (the SDK already provides `longestWaso`/`wasoCount` in `AsleepStat` and other base metrics — apps add UI-specific layers on top)
- Cross-feature coordination: Live Activity, Widgets, push notifications
- Persistent storage (UserStorage, AsyncStorage, MMKV)
- Analytics / observability — emit events the consumer hooks into, do not log directly
- Application state (tracking start time as wall-clock, user preferences, feature flags)

### Anti-patterns currently in the codebase (to fix in v2.0)

1. **UI calls from the library** — `Alert.alert("Microphone permission denied")` in `src/index.ts:56`. The library must not invoke `Alert`, `Modal`, or any UI surface. Throw a typed error and let the app render its own UX.
2. **Redundant `console.error` alongside `throw`** — many catch blocks log via `console.error` and re-throw the same error (~9 occurrences in `src/AsleepStore.ts`). The throw already surfaces the error; the duplicate log clutters consumer output and bypasses observability systems like Sentry. Strip the log, keep the throw. (Note: `console.warn` for deprecations and `__DEV__`-gated warnings are fine — that matches React/RN convention.)
3. **Auto-request permissions inside `startTracking`** — `startTracking` silently calls `requestRequiredPermissions`. This causes "spooky" permission dialogs from the consumer's perspective. Split into `hasRequiredPermissions()` (check) and `requestRequiredPermissions()` (request); `startTracking` assumes permission and throws if missing.
4. **Parallel API surfaces with state divergence** — the `Asleep` class default export calls `AsleepModule` directly and skips the zustand store, so `useAsleep().isTracking` does not update when `asleep.startTracking()` is called. See #47.
5. **`addEventListener` only on the class, not in hook output or namespace** — forces consumers into `ref` hacks or store-internal access.
6. **Wall-clock state and getter exposed publicly** — `trackingStartTime` is stored in the zustand store and `getTrackingDurationMinutes()` is exposed as a public method (`src/AsleepStore.ts:31` and `src/AsleepStore.ts:613`). The actual consumer (sleepstar) maintains its own start-time and computes duration with finer-grained timers, so these public surfaces are unused. Keep `trackingStartTime` internal for restore logic; consider removing the public `getTrackingDurationMinutes` API in v2.0.

### Real-world consumer pattern (validation)

[`asleep-ai/sleepstar`](https://github.com/asleep-ai/sleepstar) is the primary consumer. Audit (May 2026) of 11 source files outside `node_modules` and worktrees:

- 100% of SDK access goes through `useAsleep()` hook
- 0 uses of `AsleepSDK`, default `asleep` export, `asleepStore`, or `addEventListener`
- Types (`AsleepReport`, `AsleepSession`, `AsleepAverageReport`) are imported as named exports

sleepstar wraps `useAsleep` in app-level hooks (`useTracking`, `useAstIdManager`, `useReport`, `useSessionMetrics`) and adds: app-level zustand store (`useTrackingStore`), Amplify cloud sync, LiveActivity/Widget/Alarm coordination, sleep-stage UI calculations, and permission UX. **All of that is correct application architecture and must not migrate into the library.**

This evidence is why v2.0 (#47) collapses to **`useAsleep` + thin escape hatch + types**, not a full `AsleepSDK` mirror.

## Development Guidelines

### State Management Pattern
- Always use store actions for state updates
- Check `isSetupInProgress` and `isTracking` flags to prevent duplicate operations
- Handle platform differences in analysis result handling

### Error Handling
- All async operations should be wrapped in try-catch blocks
- Errors are automatically stored in the state and accessible via the `error` property
- Use the `addLog` function for debug logging when `enableLog(true)` is set
- **`console.*` discipline** (matches RN library convention — React, Reanimated, React Navigation, etc. all follow this):
  - Do NOT pair `console.error` with `throw` of the same error — the throw alone surfaces it; the duplicate log clutters consumer output
  - Do NOT use `console.error` as the only error handling — throw or emit so consumers can react
  - Do NOT use `console.log` in normal operation flow — use the opt-in `addLog` action when `enableLog(true)`
  - OK to use `console.warn` for one-shot deprecation notices (`[lib] X is deprecated, use Y`)
  - OK to use `__DEV__`-gated warnings for developer education (lint-like checks)
- **Do not call `Alert.alert` or any UI primitive** — the library is headless; the consumer renders UX

### Testing Changes
- Test on both iOS and Android platforms
- Verify permission handling flows
- Test background tracking scenarios
- Ensure state consistency across tracking lifecycle

### Release Process
- Uses semantic-release with custom configuration
- All commits trigger patch releases
- Changelog automatically generated
- NPM publishing handled by GitHub Actions
