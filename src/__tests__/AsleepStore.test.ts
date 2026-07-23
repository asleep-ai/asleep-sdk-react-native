/**
 * Tests for the v1.0.18 patch — non-breaking fixes applied on top of the
 * zustand-backed store.
 *
 * Locks in:
 * - Ref-counted initializeAsleepListeners (multi-mount safety)
 * - addLog gated on showDebugLog (default is zero-cost)
 * - Batched event handler setStates (one notification per native event)
 * - Success path error clear (no stale failure messages)
 * - console.error spy guard (regression prevention)
 * - __DEV__ gate on warnings
 */
import type { MockAsleepModule, MockEventEmitter } from "./_helpers/factories.test";

let mockModule: MockAsleepModule;
let mockEmitter: MockEventEmitter;

jest.mock("../AsleepModule", () => {
  const { createMockAsleepModule } = require("./_helpers/factories.test");
  mockModule = createMockAsleepModule();
  return { __esModule: true, default: mockModule };
});

jest.mock("expo-modules-core", () => {
  const { createMockEventEmitter } = require("./_helpers/factories.test");
  mockEmitter = createMockEventEmitter();
  return {
    EventEmitter: jest.fn().mockImplementation(() => mockEmitter),
    requireNativeModule: jest.fn(() => mockModule),
  };
});

jest.mock("react-native", () => {
  const platform = { OS: "ios" as "ios" | "android", Version: 17 as number };
  return {
    Platform: platform,
    PermissionsAndroid: {
      PERMISSIONS: { RECORD_AUDIO: "RECORD_AUDIO", POST_NOTIFICATIONS: "POST_NOTIFICATIONS" },
      RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
      requestMultiple: jest.fn().mockResolvedValue({
        RECORD_AUDIO: "granted",
        POST_NOTIFICATIONS: "granted",
      }),
    },
  };
});

import { useAsleepStore, initializeAsleepListeners } from "../AsleepStore";

const setPlatform = (os: "ios" | "android", version = 33) => {
  const rn = require("react-native");
  rn.Platform.OS = os;
  rn.Platform.Version = version;
};

const captureInitial = () => {
  const s = useAsleepStore.getState();
  return {
    didClose: s.didClose,
    isTracking: s.isTracking,
    isTrackingPaused: s.isTrackingPaused,
    isRecoveryRequired: s.isRecoveryRequired,
    error: s.error,
    errorInfo: s.errorInfo,
    userId: s.userId,
    sessionId: s.sessionId,
    showDebugLog: s.showDebugLog,
    log: s.log,
    analysisResult: s.analysisResult,
    isODAEnabled: s.isODAEnabled,
    isAnalyzing: s.isAnalyzing,
    trackingStartTime: s.trackingStartTime,
    isInitialized: s.isInitialized,
    isSetupInProgress: s.isSetupInProgress,
    isSetupComplete: s.isSetupComplete,
    hasCheckedStatus: s.hasCheckedStatus,
    hasCheckedBatteryOptimization: s.hasCheckedBatteryOptimization,
  };
};

const INITIAL = captureInitial();

const resetStore = () => {
  useAsleepStore.setState({ ...INITIAL });
  jest.clearAllMocks();
  setPlatform("ios", 17);
};

// Library-boundary guard: the store must never bypass consumer observability
// by writing to console.error. Any test that triggers it is a regression.
let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(consoleErrorSpy).not.toHaveBeenCalled();
  consoleErrorSpy.mockRestore();
});

describe("initializeAsleepListeners ref counting", () => {
  // The module-private refCount is not directly readable from tests, so we
  // track every cleanup we create and drain them in afterEach. This keeps
  // refCount at 0 between tests even if an assertion failure short-circuits
  // an earlier test before its own cleanup call.
  const cleanups: (() => void)[] = [];
  const trackedInit = () => {
    const c = initializeAsleepListeners();
    cleanups.push(c);
    return c;
  };

  beforeEach(resetStore);
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("first cleanup does not detach listeners while another holder is active", () => {
    const cleanupA = trackedInit();
    trackedInit(); // cleanupB
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);

    cleanupA();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
  });

  it("calling the same cleanup twice is a no-op", () => {
    const cleanupA = trackedInit();
    trackedInit(); // cleanupB
    cleanupA();
    cleanupA();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
  });

  it("re-initializes cleanly after final teardown", () => {
    const cleanup1 = trackedInit();
    cleanup1();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(0);

    trackedInit();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
  });
});

describe("notification batching (one setState per native event)", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStore();
    cleanup = initializeAsleepListeners();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  // With enableLog(false) (the default), addLog is a no-op for state.
  // Every batched handler produces exactly ONE subscriber notification.
  const expectSingleNotificationFor = (event: string, payload: unknown, setup?: () => void) => {
    setup?.();
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    mockEmitter.__emit(event, payload);
    off();
    expect(listener).toHaveBeenCalledTimes(1);
  };

  it("onTrackingCreated → single notification", () => {
    expectSingleNotificationFor("onTrackingCreated", { sessionId: "sess-1" });
  });

  it("onTrackingClosed → single notification", () => {
    expectSingleNotificationFor("onTrackingClosed", { sessionId: "final" }, () => {
      useAsleepStore.setState({ isTracking: true, isAnalyzing: true, trackingStartTime: new Date() });
    });
  });

  it("onTrackingFailed (terminal) → single notification", () => {
    expectSingleNotificationFor("onTrackingFailed", { code: "UPLOAD_TRACKING_TERMINATED", error: "x" }, () => {
      useAsleepStore.setState({ isTracking: true });
    });
  });

  it("onTrackingResumed (was paused) → single notification", () => {
    expectSingleNotificationFor("onTrackingResumed", undefined, () => {
      useAsleepStore.setState({ isTrackingPaused: true, error: "stale" });
    });
  });

  it("onSetupDidComplete → single notification", () => {
    expectSingleNotificationFor("onSetupDidComplete", undefined);
  });

  it("onSetupDidFail → single notification", () => {
    expectSingleNotificationFor("onSetupDidFail", { error: "boom" });
  });

  it("onAnalysisResult → single notification", () => {
    expectSingleNotificationFor("onAnalysisResult", { id: "a", state: "ANALYZING" }, () => {
      useAsleepStore.setState({ isAnalyzing: true });
    });
  });

  it("onMicPermissionDenied → zero notifications (no state change with log gated)", () => {
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onMicPermissionDenied", undefined);
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it("onTrackingUploaded triggers the native analysis call exactly once per ODA upload", () => {
    // The store action requestAnalysis wraps mockModule.requestAnalysis. Counting
    // the native call locks in that the handler no longer pre-flips isAnalyzing
    // separately and then redundantly invokes requestAnalysis (which also flips it).
    useAsleepStore.setState({ isODAEnabled: true, isTracking: true });
    mockModule.requestAnalysis.mockClear();
    mockEmitter.__emit("onTrackingUploaded", { sequence: 1 });
    expect(mockModule.requestAnalysis).toHaveBeenCalledTimes(1);
  });

  it("onTrackingUploaded triggers analysis on non-ODA modulo cadence (sequence 11, 21, …)", () => {
    // Non-ODA path: analysis fires when sequence >= 10 and sequence % 10 === 1.
    // Lock the modulo so a future rebase cannot quietly drop the cadence.
    useAsleepStore.setState({ isODAEnabled: false, isTracking: true });
    mockModule.requestAnalysis.mockClear();

    mockEmitter.__emit("onTrackingUploaded", { sequence: 11 });
    expect(mockModule.requestAnalysis).toHaveBeenCalledTimes(1);

    mockEmitter.__emit("onTrackingUploaded", { sequence: 12 });
    expect(mockModule.requestAnalysis).toHaveBeenCalledTimes(1); // no trigger off-cadence

    mockEmitter.__emit("onTrackingUploaded", { sequence: 21 });
    expect(mockModule.requestAnalysis).toHaveBeenCalledTimes(2);
  });

  it("onTrackingFailed with a non-terminal code preserves isTracking and only stores the error", () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true });
    mockEmitter.__emit("onTrackingFailed", { code: "RECOVERABLE_GLITCH", error: "minor" });
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(true);
    expect(s.isAnalyzing).toBe(true);
    expect(s.error).toContain("minor");
  });

  it("AUDIO_INITIALIZATION_FAILED clears tracking but leaves the native session open", () => {
    useAsleepStore.setState({
      isTracking: true,
      isAnalyzing: true,
      didClose: false,
      trackingStartTime: new Date(),
    });
    // Real iOS payload carries sdkCode 11003 — the same number is in the
    // Android terminal set, so this test also locks in string-bucket precedence.
    mockEmitter.__emit("onTrackingFailed", {
      code: "AUDIO_INITIALIZATION_FAILED",
      error: "audio failed",
      sdkCode: 11003,
    });

    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.trackingStartTime).toBeNull();
    expect(s.didClose).toBe(false);
  });

  it("CANNOT_ACTIVATE_IN_BACKGROUND keeps tracking active and requires recovery", () => {
    useAsleepStore.setState({ isTracking: true, isRecoveryRequired: false });
    mockEmitter.__emit("onTrackingFailed", {
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      error: "background activation failed",
    });

    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(true);
    expect(s.isRecoveryRequired).toBe(true);
  });

  it("marks recovery required when failure follows interrupted and resumed events", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingInterrupted", undefined);
    mockEmitter.__emit("onTrackingResumed", undefined);
    mockEmitter.__emit("onTrackingFailed", {
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      error: "background activation failed",
    });

    const s = useAsleepStore.getState();
    expect(s.isTrackingPaused).toBe(false);
    expect(s.isRecoveryRequired).toBe(true);
  });

  it("clears recovery required when the retry escalates to a terminal failure", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", { code: "CANNOT_ACTIVATE_IN_BACKGROUND", error: "background" });
    expect(useAsleepStore.getState().isRecoveryRequired).toBe(true);

    // iOS retries cannotActivateInBackground 3x, then gives up with
    // interruptionRecoveryFailed. No upload will ever arrive to clear the flag.
    mockEmitter.__emit("onTrackingFailed", { code: "INTERRUPTION_RECOVERY_FAILED", error: "gave up" });

    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.didClose).toBe(true);
    expect(s.isRecoveryRequired).toBe(false);
  });

  it("clears recovery required when recording dies after a recovery attempt", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", {
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      error: "background",
      sdkCode: 11000,
    });
    mockEmitter.__emit("onTrackingFailed", {
      code: "AUDIO_INITIALIZATION_FAILED",
      error: "audio failed",
      sdkCode: 11003,
    });

    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isRecoveryRequired).toBe(false);
  });

  it("clears recovery required after the next uploaded chunk", () => {
    useAsleepStore.setState({ isTracking: true, isRecoveryRequired: true });
    mockEmitter.__emit("onTrackingUploaded", { sequence: 1 });
    expect(useAsleepStore.getState().isRecoveryRequired).toBe(false);
  });

  it("enableLog(true) opts log writes back in (+1 notify per event)", () => {
    useAsleepStore.getState().enableLog(true);
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onMicPermissionDenied", undefined);
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    useAsleepStore.getState().enableLog(false);
  });
});

describe("errorInfo classification", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStore();
    cleanup = initializeAsleepListeners();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("classifies terminal string codes and mirrors category into the error string", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", { code: "UPLOAD_TRACKING_TERMINATED", error: "x", sdkCode: 23499 });

    const s = useAsleepStore.getState();
    expect(s.errorInfo).toEqual({ code: "UPLOAD_TRACKING_TERMINATED", category: "terminal", sdkCode: 23499 });
    expect(JSON.parse(s.error!).category).toBe("terminal");
  });

  it("classifies Android terminal numeric codes and clears tracking state (regression: stuck isTracking)", () => {
    // Android sends the generic "TRACKING_FAILED" string for terminal codes
    // like 11003 (ERR_AUDIO). Before sdkCode classification these fell into the
    // else bucket: isTracking stayed true forever because the native module
    // suppresses the dual-fired onFinish for exactly these codes.
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true, trackingStartTime: new Date() });
    mockEmitter.__emit("onTrackingFailed", { code: "TRACKING_FAILED", error: "audio dead", sdkCode: 11003 });

    const s = useAsleepStore.getState();
    expect(s.errorInfo?.category).toBe("terminal");
    expect(s.isTracking).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.didClose).toBe(true);
    expect(s.trackingStartTime).toBeNull();
  });

  it("classifies recording-dead codes, letting the iOS string win over the numeric terminal set", () => {
    // iOS sends sdkCode 11003 here; on Android the same number is session-terminal.
    // The explicit string bucket must win: session is still open (didClose false).
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", {
      code: "AUDIO_INITIALIZATION_FAILED",
      error: "audio failed",
      sdkCode: 11003,
    });
    const s = useAsleepStore.getState();
    expect(s.errorInfo?.category).toBe("recordingDead");
    expect(s.isTracking).toBe(false);
    expect(s.didClose).toBe(false);
  });

  it("classifies recovery-required codes", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", {
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      error: "background",
      sdkCode: 11000,
    });
    expect(useAsleepStore.getState().errorInfo?.category).toBe("recoveryRequired");
  });

  it("classifies survivable upload failures as transient and preserves tracking", () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true });
    mockEmitter.__emit("onTrackingFailed", { code: "TRACKING_FAILED", error: "upload blip", sdkCode: 23000 });

    const s = useAsleepStore.getState();
    expect(s.errorInfo?.category).toBe("transient");
    expect(s.isTracking).toBe(true);
    expect(s.isAnalyzing).toBe(true);
  });

  it("falls back to unknown for unclassified codes and preserves tracking state", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", {
      code: "UNKNOWN_ERROR",
      error: "mystery",
      caseName: "httpStatus(500, ...)",
      sdkCode: 12345,
    });

    const s = useAsleepStore.getState();
    expect(s.errorInfo).toEqual({
      code: "UNKNOWN_ERROR",
      category: "unknown",
      sdkCode: 12345,
      caseName: "httpStatus(500, ...)",
    });
    expect(s.isTracking).toBe(true);
  });

  it("keeps the terminal state transition for terminal-by-sdkCode a single notification", () => {
    useAsleepStore.setState({ isTracking: true });
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onTrackingFailed", { code: "TRACKING_FAILED", error: "x", sdkCode: 22500 });
    off();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("errorInfo lockstep with error", () => {
  const staleInfo = { code: "TRACKING_FAILED", category: "transient" as const, sdkCode: 23000 };

  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStore();
    cleanup = initializeAsleepListeners();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("startTracking() clears errorInfo alongside error on success", async () => {
    useAsleepStore.setState({
      error: "stale",
      errorInfo: staleInfo,
      hasCheckedStatus: true,
      hasCheckedBatteryOptimization: true,
    });
    await useAsleepStore.getState().startTracking();
    const s = useAsleepStore.getState();
    expect(s.error).toBeNull();
    expect(s.errorInfo).toBeNull();
  });

  it("stopTracking() clears errorInfo alongside error on success", async () => {
    useAsleepStore.setState({ error: "stale", errorInfo: staleInfo, isTracking: true });
    await useAsleepStore.getState().stopTracking();
    const s = useAsleepStore.getState();
    expect(s.error).toBeNull();
    expect(s.errorInfo).toBeNull();
  });

  it("non-lifecycle catches reset errorInfo so a previous event's category cannot linger", async () => {
    useAsleepStore.setState({ errorInfo: staleInfo });
    mockModule.requestAnalysis.mockRejectedValueOnce(new Error("analysis failed"));
    await useAsleepStore.getState().requestAnalysis();

    const s = useAsleepStore.getState();
    expect(s.error).toBe("analysis failed");
    expect(s.errorInfo).toBeNull();
  });

  it("stopTracking catch clears a stale verdict from an earlier failure", async () => {
    useAsleepStore.setState({ errorInfo: staleInfo, isTracking: true });
    mockModule.stopTracking.mockRejectedValueOnce(new Error("stop failed"));
    await expect(useAsleepStore.getState().stopTracking()).rejects.toThrow("stop failed");

    const s = useAsleepStore.getState();
    expect(s.error).toBe("stop failed");
    expect(s.errorInfo).toBeNull();
  });

  it("startTracking guard failure writes the new error even when a stale verdict exists", async () => {
    // Guard throws happen before the pre-native clear; a verdict left by an
    // earlier failure must not swallow the new error message.
    useAsleepStore.setState({ errorInfo: staleInfo, error: "old", hasCheckedStatus: false });
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow("checkAndRestoreTracking");

    const s = useAsleepStore.getState();
    expect(s.error).toContain("checkAndRestoreTracking");
    expect(s.errorInfo).toBeNull();
  });

  it("startTracking rejection preserves a concurrently classified errorInfo", async () => {
    // Android order: native fires the classified onTrackingFailed event first,
    // then rejects the same start promise. The catch must not clobber the
    // verdict with the raw rejection message.
    useAsleepStore.setState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    let rejectStart!: (e: Error) => void;
    const nativeCallReached = new Promise<void>((resolveReached) => {
      mockModule.startTracking.mockImplementationOnce(() => {
        resolveReached();
        return new Promise((_, reject) => {
          rejectStart = reject;
        });
      });
    });
    const startPromise = useAsleepStore.getState().startTracking();
    // Wait until the action's pre-await setState has run (it precedes the
    // native call), so the emitted event lands mid-await like on a device.
    await nativeCallReached;
    mockEmitter.__emit("onTrackingFailed", { code: "TRACKING_FAILED", error: "create failed", sdkCode: 22500 });
    rejectStart!(new Error("Sleep tracking failed: 22500 - create failed"));
    await expect(startPromise).rejects.toThrow("22500");

    const s = useAsleepStore.getState();
    expect(s.errorInfo).toEqual({ code: "TRACKING_FAILED", category: "terminal", sdkCode: 22500 });
    expect(JSON.parse(s.error!).category).toBe("terminal");
    expect(s.isTracking).toBe(false);
    expect(s.trackingStartTime).toBeNull();
  });

  it("clearError() clears both fields", () => {
    useAsleepStore.setState({ error: "stale", errorInfo: staleInfo });
    useAsleepStore.getState().clearError();
    const s = useAsleepStore.getState();
    expect(s.error).toBeNull();
    expect(s.errorInfo).toBeNull();
  });

  it("onTrackingResumed clears both fields", () => {
    useAsleepStore.setState({ error: "stale", errorInfo: staleInfo, isTrackingPaused: true });
    mockEmitter.__emit("onTrackingResumed", undefined);
    const s = useAsleepStore.getState();
    expect(s.error).toBeNull();
    expect(s.errorInfo).toBeNull();
  });

  it("getReport() success clears errorInfo together with the guarded error clear", async () => {
    useAsleepStore.setState({ error: "stale", errorInfo: staleInfo });
    mockModule.getReport.mockResolvedValueOnce({ timezone: "", session: {} });
    await useAsleepStore.getState().getReport("a");
    const s = useAsleepStore.getState();
    expect(s.error).toBeNull();
    expect(s.errorInfo).toBeNull();
  });
});

describe("resumeTracking platform support", () => {
  beforeEach(resetStore);

  it("rejects on Android with a typed unsupported-platform error", async () => {
    setPlatform("android");
    await expect(useAsleepStore.getState().resumeTracking()).rejects.toMatchObject({
      name: "AsleepPlatformError",
      code: "UNSUPPORTED_PLATFORM",
      message: "resumeTracking is only supported on iOS.",
    });
  });
});

describe("success error clear is guarded — no spurious notifications", () => {
  beforeEach(resetStore);

  it("getReport success does NOT notify subscribers when error was already null", async () => {
    mockModule.getReport.mockResolvedValueOnce({ timezone: "", session: {} });
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    await useAsleepStore.getState().getReport("a");
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it("getReportList success is silent when error was already null", async () => {
    mockModule.getReportList.mockResolvedValueOnce([]);
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    await useAsleepStore.getState().getReportList("a", "b");
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it("getReport success DOES notify exactly once when there was a stale error", async () => {
    useAsleepStore.setState({ error: "stale" });
    mockModule.getReport.mockResolvedValueOnce({ timezone: "", session: {} });
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    await useAsleepStore.getState().getReport("a");
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("getReport success does NOT clobber an unrelated error that arrived during the await", async () => {
    // Seed an initial state error (the snapshot the guard captures).
    useAsleepStore.setState({ error: "old report error" });
    // Resolve the native call only after we inject an interleaved error.
    let resolveGet: (value: unknown) => void;
    mockModule.getReport.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    const getPromise = useAsleepStore.getState().getReport("a");
    // Simulate a concurrent native failure landing while the await is in flight.
    useAsleepStore.setState({ error: "tracking failed mid-flight" });
    resolveGet!({ timezone: "", session: {} });
    await getPromise;
    // The capture-and-compare guard must leave the interleaved error untouched.
    expect(useAsleepStore.getState().error).toBe("tracking failed mid-flight");
  });
});

describe("success path clears stale error", () => {
  beforeEach(resetStore);

  it("setup() clears error on success", async () => {
    useAsleepStore.setState({ error: "stale failure" });
    await useAsleepStore.getState().setup({ apiKey: "k" });
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("startTracking() clears error on success", async () => {
    useAsleepStore.setState({
      error: "stale",
      hasCheckedStatus: true,
      hasCheckedBatteryOptimization: true,
    });
    await useAsleepStore.getState().startTracking();
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("stopTracking() clears error on success", async () => {
    useAsleepStore.setState({ error: "stale", isTracking: true });
    await useAsleepStore.getState().stopTracking();
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("getReport() clears error on success", async () => {
    useAsleepStore.setState({ error: "stale" });
    mockModule.getReport.mockResolvedValueOnce({ timezone: "", session: {} });
    await useAsleepStore.getState().getReport("a");
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("getReportList() clears error on success", async () => {
    useAsleepStore.setState({ error: "stale" });
    mockModule.getReportList.mockResolvedValueOnce([]);
    await useAsleepStore.getState().getReportList("from", "to");
    expect(useAsleepStore.getState().error).toBeNull();
  });
});

describe("addLog gating", () => {
  beforeEach(resetStore);

  it("forwards enableLog to the native logger on iOS", () => {
    useAsleepStore.getState().enableLog(true);
    expect(mockModule.enableLog).toHaveBeenCalledWith(true);

    useAsleepStore.getState().enableLog(false);
    expect(mockModule.enableLog).toHaveBeenLastCalledWith(false);
  });

  it("does not call the iOS logger bridge on Android", () => {
    setPlatform("android");
    useAsleepStore.getState().enableLog(true);
    expect(mockModule.enableLog).not.toHaveBeenCalled();
  });

  it("does not write to state when showDebugLog is false (default)", () => {
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    useAsleepStore.getState().addLog("[test] hello");
    off();
    expect(listener).not.toHaveBeenCalled();
    expect(useAsleepStore.getState().log).toBe("");
  });

  it("writes to state when enableLog(true) is set", () => {
    useAsleepStore.getState().enableLog(true);
    const listener = jest.fn();
    const off = useAsleepStore.subscribe(listener);
    useAsleepStore.getState().addLog("[test] hello");
    off();
    expect(listener).toHaveBeenCalled();
    expect(useAsleepStore.getState().log).toContain("[test] hello");
  });
});

describe("__DEV__ gated warnings", () => {
  const setDev = (value: boolean) => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = value;
  };

  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    resetStore();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    setDev(true);
    warnSpy.mockRestore();
  });

  it("setCustomNotification on iOS warns in dev with [Asleep] prefix", async () => {
    setPlatform("ios");
    setDev(true);
    await useAsleepStore.getState().setCustomNotification("t", "x");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[Asleep]"));
  });

  it("setCustomNotification on iOS is silent in production", async () => {
    setPlatform("ios");
    setDev(false);
    await useAsleepStore.getState().setCustomNotification("t", "x");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("query methods that silently return null/[] surface a dev-only warn", async () => {
    setDev(true);
    mockModule.getReport.mockRejectedValueOnce(new Error("net down"));
    await useAsleepStore.getState().getReport("any");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("getReport failed"), expect.any(Error));
  });

  it("query method warn is silent in production", async () => {
    setDev(false);
    mockModule.getReport.mockRejectedValueOnce(new Error("net down"));
    await useAsleepStore.getState().getReport("any");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("requestMicrophonePermission deprecation is dev-gated", async () => {
    setDev(false);
    await useAsleepStore.getState().requestMicrophonePermission();
    expect(warnSpy).not.toHaveBeenCalled();

    setDev(true);
    await useAsleepStore.getState().requestMicrophonePermission();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
  });
});
