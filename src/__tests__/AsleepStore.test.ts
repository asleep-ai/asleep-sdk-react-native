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
    error: s.error,
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
