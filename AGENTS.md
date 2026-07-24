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

2. **State Model** (`src/AsleepStore.ts` + `src/store/createStore.ts`)
   - Singleton vanilla store built on `useSyncExternalStore`; no external state-library dependency
   - Stores native facts (`setupStatus`, `trackingStatus`, identifiers, analysis, and one structured error)
   - Funnels every native event through a pure transition and one store write
   - Owns the ref-counted native-listener lifecycle

3. **API Surface** (`src/index.ts`) — v2.0 lean surface:
   - `useAsleep` — primary React hook; returns the public state projection plus bound actions
   - `Asleep` — thin imperative escape hatch with `initialize`, `getState`, `subscribe`, and `addEventListener`
   - `AsleepError` — named value export; data/config/event models are named type exports
   - No default export, public store, mutable setters, or parallel SDK namespace

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
- State synchronization between native and JS (via the internal vanilla store and event reducer)
- Raw data exposure: `sessionId`, `analysisResult`, `AsleepReport`, `AsleepSession`, `AsleepAverageReport`, `AsleepError`
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

### v2.0 boundary decisions

- The library is headless: no `Alert`, modal, permission-denied screen, or other UI primitive.
- `startTracking` checks permission without requesting it. Consumers explicitly call `requestRequiredPermissions()` from a user-driven flow.
- `useAsleep` and `Asleep` read the same memoized public projection; no parallel direct-native API may bypass the store.
- `AsleepError` is the single error object. Classification lives on `error.category` / `error.sdkCode` / `error.caseName`.
- Native events and SDK actions are the sole state writers. Public setters and the raw store are not exported.
- `trackingStartTime` is internal restore state. Apps own wall-clock duration and product timers.
- The package has no external state-library dependency.

### Real-world consumer pattern (validation)

[`asleep-ai/sleepstar`](https://github.com/asleep-ai/sleepstar) is the primary consumer. Audit (May 2026) of 11 source files outside `node_modules` and worktrees:

- 100% of SDK access goes through `useAsleep()` hook
- 0 uses of the removed `AsleepSDK`, default `asleep` export, or raw store
- Types (`AsleepReport`, `AsleepSession`, `AsleepAverageReport`) are imported as named exports

sleepstar wraps `useAsleep` in app-level hooks (`useTracking`, `useAstIdManager`, `useReport`, `useSessionMetrics`) and adds app-owned state, cloud sync, LiveActivity/Widget/Alarm coordination, sleep-stage UI calculations, and permission UX. **All of that is correct application architecture and must not migrate into the library.**

This evidence is why v2.0 (#47) collapses to **`useAsleep` + thin escape hatch + types**, not a full `AsleepSDK` mirror.

## Development Guidelines

### State Management Pattern

These eight rules are the v2 state-model review checklist:

1. **Native is the source of truth.** The JS store is a projection. Hydrate initial tracking state from `AsleepModule.isTracking()` and keep cold-start restore in `checkAndRestoreTracking()`.
2. **One writer per fact.** State fields have an explicit owner: native event reducer, action result, or restore path. Do not add public setters or competing promise/event writers.
3. **Illegal states are unrepresentable.** Store `SetupStatus` and `TrackingStatus`; derive public booleans in the shared projection instead of storing overlapping flags.
4. **One notification per native event.** Every handler computes one partial through `applyEvent` and performs one `setState`. If debug logging is enabled, fold the log line into that same partial.
5. **Errors are one object.** Store one `AsleepError` carrying `code`, `category`, `sdkCode`, `caseName`, and `cause`; never create a parallel classification field.
6. **Every await seam is guarded.** Snapshot `error` before a native call. A success may clear only that snapshot; a failure must preserve and throw a classified event error that arrived during the await.
7. **Derived data is not stored.** `trackingStartTime` stays internal for restore logic; apps own wall-clock duration.
8. **Import is side-effect-free.** Attach native listeners only through the ref-counted initializer used by `useAsleep` and `Asleep.initialize()`.

Additional state rules:

- `toPublicState(internal)` is the only projection used by both public surfaces and must memoize by internal-state reference.
- `onAnalysisResult` is the only writer of `analysisResult`; normalize Android snake_case before storing.
- Keep failure buckets mutually exclusive and ordered: recording-dead string codes, recovery-required string codes, terminal string/numeric codes, transient numeric codes, then unknown.
- Add a regression test for every real-device escalation path and assert notification counts for every event with logging both disabled and enabled.

### Error Handling & Signals

The library selects a mechanism by signal type:

| Signal type | Mechanism | Example |
|---|---|---|
| Runtime failure | Normalize and throw `AsleepError`; store the same instance when applicable | Native bridge rejection |
| Precondition violation | Throw `AsleepError` with `MISSING_PREREQUISITE`, `INVALID_STATE`, `OPERATION_IN_PROGRESS`, `PERMISSION_DENIED`, or `BATTERY_NOT_EXEMPTED` | `startTracking` before required checks |
| Unsupported platform | Throw `AsleepError("UNSUPPORTED_PLATFORM", ...)` | `resumeTracking()` on Android |
| Native failure event | Normalize payload once and write it through the event reducer | `onTrackingFailed`, `onSetupDidFail`, `onUserJoinFailed` |
| Deprecation/developer education | `[Asleep]`-prefixed `console.warn`, guarded by `typeof __DEV__ !== "undefined" && __DEV__` | Deprecated no-op |
| Operational log | Fold `addLog(message)` into the current event partial when `enableLog(true)` | Tracking lifecycle trace |

- Every action and query throws `AsleepError` on failure; do not return `null` or `[]` as an error sentinel.
- `normalizeError` must preserve native `sdkCode` and `caseName`, retain the original value as `cause`, and never stringify an error into its message.
- `startTracking` and `stopTracking` must throw the classified error instance published during the same native call instead of replacing it with the promise rejection.
- Success paths use the snapshot guard; they never clear an error written while awaiting the native result.
- **`console.*` discipline** (matches RN library convention — React, Reanimated, React Navigation, etc. all follow this):
  - Do NOT pair `console.error` with `throw` of the same error — the throw alone surfaces it; the duplicate log clutters consumer output
  - Do NOT use `console.error` as the only error handling — throw or emit so consumers can react
  - Do NOT use `console.log` in normal operation flow — use the opt-in `addLog` action when `enableLog(true)`
  - Every warning is `[Asleep]`-prefixed and guarded by `typeof __DEV__ !== "undefined" && __DEV__`
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
| JS feature (new public API on `useAsleep`/`Asleep`) | `feat: ...` | minor |
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
| `.audioInitializationFailed` maps to `AUDIO_INITIALIZATION_FAILED`, and the recording-dead event transition sets `trackingStatus: "idle"` without setting `didClose` | `ios/AsleepModule.swift` `didFail(error:)`; `src/AsleepStore.ts` tracking-failure reducer | iOS SDK 3.2.0 `Asleep.SleepTrackingManager+Delegate.swift:31-38` stops tracking with `shouldCloseSession: false`; `TrackingOrchestrator.swift:431-436` stops the recorder and returns before closing the session. Recording is dead, but the native session remains open and must be stopped before starting again |
| `.cannotActivateInBackground` maps to `CANNOT_ACTIVATE_IN_BACKGROUND`, and the recovery-required transition sets `trackingStatus: "recoveryRequired"` | `ios/AsleepModule.swift` `didFail(error:)`; `src/AsleepStore.ts` tracking-failure reducer | iOS SDK 3.2.0 `RecordingService+EngineLifecycle.swift:133-145` reports the error when the engine cannot start; `RecordingService+State.swift:175-190` emits resume before attempting the engine restart. The consumer must use `isRecoveryRequired` and call `resumeTracking()` in foreground; only a later upload proves recovery |
| Terminal string and numeric error buckets set `trackingStatus: "idle"`, clear analysis/start-time facts, and set `didClose` | `src/AsleepStore.ts` tracking-failure reducer | iOS 3.2.1 `closeSessionSilently()` on 403/429 (and `interruptionRecoveryFailed` after 3 retries) tears the session down internally without firing `didClose`. JS state would otherwise remain tracking forever, blocking subsequent `startTracking()` calls via the duplicate-call guard |
| `onTrackingResumed` clears error unconditionally but changes status only when `trackingStatus === "paused"` | `src/AsleepStore.ts` event reducer | iOS 3.2.1 `RecordingService` fires `interruptedSender.send(false)` from both `handleRecovering()` and `handleResumed()`, producing two `didResume` events per recovery cycle. Some iOS recovery paths (e.g. `cannotActivateInBackground` retry) also reach this handler without a preceding `didInterrupt`, so error clearing must happen unconditionally while only the dedup-sensitive paused-state write stays gated |
| `onAnalysisResult` runs `convertKeysToCamelCase(data)` before writing to the store | `src/AsleepStore.ts` event reducer | Android SDK 3.2.x serializes session payloads with snake_case keys (`sleep_stages`, `sleep_start_time`, etc.) when bridging through Expo modules. iOS emits camelCase. Without normalization, consumers reading `analysisResult` from the store get mixed casing across platforms and the documented `AsleepAnalysisResult` type only matches iOS |
| `requestAnalysis` action does NOT write `analysisResult`/`isAnalyzing` from the resolved promise | `src/AsleepStore.ts` `requestAnalysis` | Android SDK 3.2.x `AsleepModule.requestAnalysis()` resolves the promise with the full session payload AND fires `onAnalysisResult` immediately after; iOS resolves with an ack only and the event carries the real payload. Writing state from the promise branch double-updates the store on Android. The event handler is the single owner |
| `sdkCode` field on iOS error payloads carries `error.errorCode.code`; legacy `errorCode` stays the NSError bridging value | `ios/AsleepModule.swift` `didFail` / `setupDidFail` / `didFailUserJoin` | iOS SDK 3.2.0 `AsleepError` does not conform to `CustomNSError`, so `(error as NSError).code` is the Swift enum declaration ordinal, not a documented Asleep code. The documented numeric code (10000-34999) is only reachable via the `errorCode` computed property (`Asleep.Interface.swift:473-572`, the doc-comment-recommended v3.2.0+ API). The ordinal `errorCode` field is kept because existing consumers match ordinals (e.g. 38/39) |
| `TERMINAL_TRACKING_SDK_CODES` (13 numeric codes) joins the terminal bucket, `TRANSIENT_TRACKING_SDK_CODES` (23000, 23500) classifies as transient, and the verdict is published as `error.category` | `src/AsleepStore.ts` tracking-failure reducer | Android maps 12 of its 13 session-terminal codes to the generic `TRACKING_FAILED` string (only 23499 gets `UPLOAD_TRACKING_TERMINATED`), so string-only matching left tracking state stuck for e.g. 11003 ERR_AUDIO. Numeric classification from `AsleepCore.kt:413-467` (terminal set) and `AsleepErrorCode.kt` (23000 ERR_UPLOAD_FAILED / 23500 ERR_UPLOAD_SERVER_ERROR are absent from it — the session survives) restores the distinction and exposes it to consumers as data instead of forcing per-app code lists. The numeric set is a FALLBACK: explicit iOS string buckets (recordingDead/recoveryRequired) win first, because iOS reuses 11003 (`.audioInitializationFailed` → `.audio`, `Asleep.Interface.swift:482-483`) for a recorder-dead-but-session-open failure while the same number is session-terminal on Android. Keep the set shared across platforms — iOS start/stop failures arriving as `UNKNOWN_ERROR` + 22xxx/24xxx rely on it to clear optimistic tracking state |

When adding a new compensation:
1. Cite the upstream SDK file/line and the version it shipped in.
2. Add a row to the table above with the location and reason.
3. If the compensation depends on a specific native version range, note it (e.g. "Android SDK >= 3.2.x").
