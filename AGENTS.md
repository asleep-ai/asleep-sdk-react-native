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
# Trigger release via GitHub Actions
# UI: Actions -> Release -> Run workflow (pick patch / minor / major)
gh workflow run release.yml -f version_type=patch
```

## Architecture

### Core Components

1. **Native Modules** (`ios/AsleepModule.swift`, `android/.../AsleepModule.kt`)
   - Platform-specific implementations wrapping native Asleep SDKs
   - Handle audio recording, permission management, and sleep tracking
   - iOS SDK version: 3.2.0, Android SDK version: 3.2.1

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

### Native SDK References (optional, local-only)

When working on native module code, consult the upstream SDK sources if available locally:
- iOS: `../asleep-sdk-ios-src` (Swift)
- Android: `../asleep-sdk-android-src` (Kotlin)

These are not part of this repo; use them to confirm native API signatures, error codes, and behavior rather than guessing.

## Library Boundary Principles

This is a **primitive SDK library**, not a sleep-tracking framework. Apps build products on top of it. The boundary is strict — when in doubt, push concerns OUT of the library.

### What this library owns

- Native module bridge (iOS Swift / Android Kotlin → JS)
- SDK lifecycle: `setup`, `initAsleepConfig`, `startTracking`, `stopTracking`, `resumeTracking`, `checkAndRestoreTracking`
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
3. **Auto-request permissions inside `startTracking`** — `startTracking` silently calls `requestRequiredPermissions`. This causes "spooky" permission dialogs from the consumer's perspective. Split into `hasRequiredPermissions()` (check) and `requestRequiredPermissions()` (request); `startTracking` assumes permission and throws if missing. *(Status: Android `beginSleepTracking` now rejects with `PERMISSION_REQUIRED` instead of calling `ActivityCompat.requestPermissions`. iOS `beginSleepTracking` in `ios/AsleepModule.swift` still needs the same treatment.)*
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
- **Error-code `Set`s that write state must be mutually exclusive or explicitly clear each other's flags.** `onTrackingFailed` dispatches on several `Set`s (`TERMINAL_`, `RECORDING_DEAD_`, `RECOVERY_REQUIRED_`) and zustand `setState` merges partials, so a flag raised by one bucket survives a later error handled by another unless that branch clears it. Add a regression test for every escalation path a real device can produce
- **`errorInfo` must stay in lockstep with `error`.** Every write or clear of `error` pairs an `errorInfo` write in the same `setState` — the classified object in `onTrackingFailed`, `null` everywhere else (action catches, success clears, `setError`). A stale `category` surviving a later unrelated error would misclassify it. Exception: the `startTracking`/`stopTracking` catches keep an already-populated `errorInfo` instead of nulling it — Android fires the classified `onTrackingFailed` event before rejecting the same lifecycle promise, and the raw rejection message must not clobber that verdict
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
- Manually triggered: `workflow_dispatch` on `.github/workflows/release.yml` with `version_type` (patch / minor / major) — pick per Versioning Policy below
- Pipeline: prepare (version bump on `release/v<x.y.z>` branch) -> build -> release-notes (bilingual EN/KR via `asleep-ai/actions/release-notes`, also runs on dry-run as a preview) -> auto-merge PR to main -> `npm publish --provenance --access public` (OIDC) + tag + `gh release create --notes-file`
- AI release notes need an `OPENAI_API_KEY` org-level secret; the action falls back to a plain commit list if it is missing or OpenAI errors

## Versioning Policy

RN SDK semver tracks the bundled native SDK changes so consumers can read the version and infer the upstream delta.

| Change | Commit prefix | RN bump |
|---|---|---|
| Native patch (e.g. 3.2.0 → 3.2.1) | `fix(deps): bump <ios\|android> SDK to X.Y.Z` | patch |
| Native minor (e.g. 3.2.x → 3.3.0) | `feat(deps): bump <ios\|android> SDK to X.Y.Z` | minor |
| Native major (e.g. 3.x → 4.0.0) | `feat(deps)!: bump <ios\|android> SDK to X.0.0` + `BREAKING CHANGE:` footer | major |
| JS feature (new public API on `useAsleep`/`AsleepSDK`) | `feat: ...` | minor |
| JS bug fix | `fix: ...` | patch |
| Docs / CI / internal chores | `chore: ...` | no release |

Classification rules:
- If a single PR bundles a native bump **and** calls new native APIs in `AsleepModule.kt` / `AsleepModule.swift`, classify by the **strongest** signal. A patch-level native bump that also exposes a new method on the JS surface is a `feat:`, not a `fix(deps):`.
- Bundled native SDK versions live in `android/build.gradle` (`ai.asleep:asleepsdk`) and `ios/Asleep.podspec` (`AsleepSDK`). Keep the README's bundled-versions table in sync.
- iOS releases are gated on the upstream iOS SDK having a real git tag (not a `feature/*` branch); do not bump the podspec to a branch-only version.

Known pitfalls when native bumps:
- Native error enums (`Asleep.AsleepError` on iOS, `AsleepErrorCode` constants on Android) commonly gain new cases at minor bumps. JS-side switches/handlers MUST include a `default`/fallback arm — exhaustive matches silently miss new cases.
- Listener / delegate protocols may gain methods with default implementations. These compile without changes but new behavior is invisible unless the RN module forwards them.
- Manifest / Info.plist / capabilities changes in native SDKs do not automatically flow to consumer apps; review the upstream changelog for any new declarations the example app or docs must mirror.

## Native Behavior Compensations

The wrapper smooths over a few native quirks so JS sees a consistent event model. Do not remove these without confirming the upstream SDK behavior has changed.

| Compensation | Location | Native quirk being compensated for |
|---|---|---|
| `failedTerminally` flag in both `AsleepTrackingListener` instances suppresses `onTrackingClosed` after `onFail`, gated on the 13-code `TERMINAL_TRACKING_ERROR_CODES` companion set | `android/src/main/java/ai/asleep/reactnative/AsleepModule.kt` (`createTrackingListener`, shared by `connectSleepTracking` and `beginSleepTracking`) | Android SDK 3.2.x `AsleepCore.onErrorCodeReceived` (`AsleepCore.kt:413-467`) fires both `onFail` and `onFinish` and tears the session down for exactly 13 fatal codes. Without the guard JS receives `onTrackingFailed` followed by `onTrackingClosed` for one fatal error; without the terminal-set gate a non-terminal `onFail` (e.g. 23000 upload-retry exhaustion, where the session survives) would suppress a later genuine `onFinish` and flip the module's internal `isTracking` while native tracking continues |
| `.interruptionRecoveryFailed` case in `didFail` switch maps to `INTERRUPTION_RECOVERY_FAILED` | `ios/AsleepModule.swift` `didFail(error:)` | iOS SDK 3.2.0 added `AsleepError.interruptionRecoveryFailed(attemptsCount:)`. Without the explicit case it falls into `default:` and JS only sees `UNKNOWN_ERROR` for a recoverable-with-foreground scenario |
| `.audioInitializationFailed` maps to `AUDIO_INITIALIZATION_FAILED`, and `RECORDING_DEAD_ERROR_CODES` clears recording state without setting `didClose` | `ios/AsleepModule.swift` `didFail(error:)`; `src/AsleepStore.ts` | iOS SDK 3.2.0 `Asleep.SleepTrackingManager+Delegate.swift:31-38` stops tracking with `shouldCloseSession: false`; `TrackingOrchestrator.swift:431-436` stops the recorder and returns before closing the session. Recording is dead, but the native session remains open and must be stopped before starting again |
| `.cannotActivateInBackground` maps to `CANNOT_ACTIVATE_IN_BACKGROUND`, and `RECOVERY_REQUIRED_ERROR_CODES` sets `isRecoveryRequired` | `ios/AsleepModule.swift` `didFail(error:)`; `src/AsleepStore.ts` | iOS SDK 3.2.0 `RecordingService+EngineLifecycle.swift:133-145` reports the error when the engine cannot start; `RecordingService+State.swift:175-190` emits resume before attempting the engine restart. The consumer must use `isRecoveryRequired` and call `resumeTracking()` in foreground; only a later upload proves recovery |
| `TERMINAL_TRACKING_ERROR_CODES` set in `onTrackingFailed` handler clears `isTracking`/`isAnalyzing`/`didClose`/`trackingStartTime` | `src/AsleepStore.ts` | iOS 3.2.1 `closeSessionSilently()` on 403/429 (and `interruptionRecoveryFailed` after 3 retries) tears the session down internally without firing `didClose`. JS state would otherwise stay `isTracking: true` forever, blocking subsequent `startTracking()` calls via the duplicate-call guard |
| `onTrackingResumed` clears error unconditionally but gates the paused-state mutation on `isTrackingPaused` | `src/AsleepStore.ts` | iOS 3.2.1 `RecordingService` fires `interruptedSender.send(false)` from both `handleRecovering()` and `handleResumed()`, producing two `didResume` events per recovery cycle. Some iOS recovery paths (e.g. `cannotActivateInBackground` retry) also reach this handler without a preceding `didInterrupt`, so error clearing must happen unconditionally while only the dedup-sensitive paused-state write stays gated |
| `onAnalysisResult` runs `convertKeysToCamelCase(data)` before writing to the store | `src/AsleepStore.ts` `initializeAsleepListeners` | Android SDK 3.2.x serializes session payloads with snake_case keys (`sleep_stages`, `sleep_start_time`, etc.) when bridging through Expo modules. iOS emits camelCase. Without normalization, consumers reading `analysisResult` from the store get mixed casing across platforms and the documented `AsleepAnalysisResult` type only matches iOS |
| `requestAnalysis` action does NOT write `analysisResult`/`isAnalyzing` from the resolved promise | `src/AsleepStore.ts` `requestAnalysis` | Android SDK 3.2.x `AsleepModule.requestAnalysis()` resolves the promise with the full session payload AND fires `onAnalysisResult` immediately after; iOS resolves with an ack only and the event carries the real payload. Writing state from the promise branch double-updates the store on Android. The event handler is the single owner |
| `sdkCode` field on iOS error payloads carries `error.errorCode.code`; legacy `errorCode` stays the NSError bridging value | `ios/AsleepModule.swift` `didFail` / `setupDidFail` / `didFailUserJoin` | iOS SDK 3.2.0 `AsleepError` does not conform to `CustomNSError`, so `(error as NSError).code` is the Swift enum declaration ordinal, not a documented Asleep code. The documented numeric code (10000-34999) is only reachable via the `errorCode` computed property (`Asleep.Interface.swift:473-572`, the doc-comment-recommended v3.2.0+ API). The ordinal `errorCode` field is kept because existing consumers match ordinals (e.g. 38/39) |
| `TERMINAL_TRACKING_SDK_CODES` (13 numeric codes) joins the terminal bucket, `TRANSIENT_TRACKING_SDK_CODES` (23000, 23500) classifies as transient, and the verdict is published as `errorInfo.category` | `src/AsleepStore.ts` `onTrackingFailed` | Android maps 12 of its 13 session-terminal codes to the generic `TRACKING_FAILED` string (only 23499 gets `UPLOAD_TRACKING_TERMINATED`), so string-only matching left `isTracking` stuck true for e.g. 11003 ERR_AUDIO. Numeric classification from `AsleepCore.kt:413-467` (terminal set) and `AsleepErrorCode.kt` (23000 ERR_UPLOAD_FAILED / 23500 ERR_UPLOAD_SERVER_ERROR are absent from it — the session survives) restores the distinction and exposes it to consumers as data instead of forcing per-app code lists. The numeric set is a FALLBACK: explicit iOS string buckets (recordingDead/recoveryRequired) win first, because iOS reuses 11003 (`.audioInitializationFailed` → `.audio`, `Asleep.Interface.swift:482-483`) for a recorder-dead-but-session-open failure while the same number is session-terminal on Android. Keep the set shared across platforms — iOS start/stop failures arriving as `UNKNOWN_ERROR` + 22xxx/24xxx rely on it to clear optimistic `isTracking` |

When adding a new compensation:
1. Cite the upstream SDK file/line and the version it shipped in.
2. Add a row to the table above with the location and reason.
3. If the compensation depends on a specific native version range, note it (e.g. "Android SDK >= 3.2.x").
