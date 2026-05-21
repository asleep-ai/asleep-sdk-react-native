/**
 * Characterization tests for the current zustand-backed AsleepStore.
 *
 * Locks in observable behavior BEFORE refactoring to a vanilla store. Any
 * change that breaks these tests is also a change that breaks the consumer
 * (sleepstar), so we want them to stay green across the refactor.
 */
import type { MockAsleepModule, MockEventEmitter } from "./_helpers/factories.test";

// jest.mock factories are hoisted above imports. They reference variables
// prefixed with `mock` (jest allows that) and lazily initialize them so the
// test file can still see the same instances.
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
// by writing to console.error. Errors should flow through the store's `error`
// field and through thrown exceptions only. Any test that triggers a console.error
// call indicates a regression of the v2.0 console.* cleanup.
let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(consoleErrorSpy).not.toHaveBeenCalled();
  consoleErrorSpy.mockRestore();
});

describe("AsleepStore initial state", () => {
  beforeEach(resetStore);

  it("starts with all flags cleared", () => {
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isTrackingPaused).toBe(false);
    expect(s.didClose).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.isODAEnabled).toBe(false);
    expect(s.isInitialized).toBe(false);
    expect(s.isSetupInProgress).toBe(false);
    expect(s.isSetupComplete).toBe(false);
    expect(s.hasCheckedStatus).toBe(false);
    expect(s.hasCheckedBatteryOptimization).toBe(false);
    expect(s.error).toBeNull();
    expect(s.userId).toBeNull();
    expect(s.sessionId).toBeNull();
    expect(s.analysisResult).toBeNull();
    expect(s.trackingStartTime).toBeNull();
  });
});

describe("setup()", () => {
  beforeEach(resetStore);

  it("marks setup complete and stores ODA flag on success", async () => {
    await useAsleepStore.getState().setup({ apiKey: "key", enableODA: true });
    const s = useAsleepStore.getState();
    expect(s.isSetupComplete).toBe(true);
    expect(s.isSetupInProgress).toBe(false);
    expect(s.isInitialized).toBe(true);
    expect(s.isODAEnabled).toBe(true);
    expect(s.error).toBeNull();
    expect(mockModule.setup).toHaveBeenCalledWith("key", undefined, undefined, undefined, true);
  });

  it("forwards every config field to native", async () => {
    await useAsleepStore.getState().setup({
      apiKey: "k",
      baseUrl: "https://b",
      callbackUrl: "https://c",
      service: "svc",
      enableODA: false,
    });
    expect(mockModule.setup).toHaveBeenCalledWith("k", "https://b", "https://c", "svc", false);
  });

  it("rejects when setup is already in progress", async () => {
    useAsleepStore.setState({ isSetupInProgress: true });
    await expect(useAsleepStore.getState().setup({ apiKey: "k" })).rejects.toThrow(/already in progress/);
    expect(mockModule.setup).not.toHaveBeenCalled();
  });

  it("rejects when tracking is in progress", async () => {
    useAsleepStore.setState({ isTracking: true });
    await expect(useAsleepStore.getState().setup({ apiKey: "k" })).rejects.toThrow(/while tracking/);
  });

  it("stores error and clears isSetupInProgress on native failure", async () => {
    mockModule.setup.mockRejectedValueOnce(new Error("boom"));
    await expect(useAsleepStore.getState().setup({ apiKey: "k" })).rejects.toThrow("boom");
    const s = useAsleepStore.getState();
    expect(s.error).toBe("boom");
    expect(s.isSetupInProgress).toBe(false);
    expect(s.isSetupComplete).toBe(false);
  });
});

describe("initAsleepConfig()", () => {
  beforeEach(resetStore);

  it("marks initialized on success and forwards params", async () => {
    await useAsleepStore.getState().initAsleepConfig({
      apiKey: "k",
      userId: "u",
      baseUrl: "https://b",
      callbackUrl: "https://c",
    });
    expect(useAsleepStore.getState().isInitialized).toBe(true);
    expect(mockModule.initAsleepConfig).toHaveBeenCalledWith("k", "u", "https://b", "https://c");
  });

  it("stores error and re-throws on native failure", async () => {
    mockModule.initAsleepConfig.mockRejectedValueOnce(new Error("init failed"));
    await expect(useAsleepStore.getState().initAsleepConfig({ apiKey: "k" })).rejects.toThrow("init failed");
    expect(useAsleepStore.getState().error).toBe("init failed");
  });
});

describe("checkAndRestoreTracking()", () => {
  beforeEach(resetStore);

  it("sets hasCheckedStatus and returns no active session by default", async () => {
    const result = await useAsleepStore.getState().checkAndRestoreTracking();
    expect(result).toEqual({ hasActiveSession: false });
    expect(useAsleepStore.getState().hasCheckedStatus).toBe(true);
    expect(useAsleepStore.getState().isTracking).toBe(false);
  });

  it("restores tracking on android when service is alive and reconnect succeeds", async () => {
    setPlatform("android");
    mockModule.isSleepTrackingAlive.mockResolvedValueOnce(true);
    mockModule.connectSleepTracking.mockResolvedValueOnce(true);
    const result = await useAsleepStore.getState().checkAndRestoreTracking();
    expect(result).toEqual({ hasActiveSession: true });
    expect(useAsleepStore.getState().isTracking).toBe(true);
  });

  it("leaves isTracking false on android when reconnect fails", async () => {
    setPlatform("android");
    mockModule.isSleepTrackingAlive.mockResolvedValueOnce(true);
    mockModule.connectSleepTracking.mockResolvedValueOnce(false);
    await useAsleepStore.getState().checkAndRestoreTracking();
    expect(useAsleepStore.getState().isTracking).toBe(false);
  });

  it("does not attempt reconnect on iOS even if alive", async () => {
    setPlatform("ios");
    mockModule.isSleepTrackingAlive.mockResolvedValueOnce(true);
    await useAsleepStore.getState().checkAndRestoreTracking();
    expect(mockModule.connectSleepTracking).not.toHaveBeenCalled();
  });
});

describe("checkBatteryOptimization()", () => {
  beforeEach(resetStore);

  it("returns exempted true on iOS without touching native", async () => {
    setPlatform("ios");
    const result = await useAsleepStore.getState().checkBatteryOptimization();
    expect(result).toEqual({ exempted: true, platform: "ios" });
    expect(mockModule.isBatteryOptimizationExempted).not.toHaveBeenCalled();
    expect(useAsleepStore.getState().hasCheckedBatteryOptimization).toBe(true);
  });

  it("queries native on android and reports the result", async () => {
    setPlatform("android");
    mockModule.isBatteryOptimizationExempted.mockResolvedValueOnce(false);
    const result = await useAsleepStore.getState().checkBatteryOptimization();
    expect(result.exempted).toBe(false);
    expect(result.platform).toBe("android");
    expect(result.message).toMatch(/must be disabled/);
  });
});

describe("startTracking() prerequisites", () => {
  beforeEach(resetStore);

  it("throws when checkAndRestoreTracking has not been called", async () => {
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow(/Must call checkAndRestoreTracking/);
    expect(mockModule.startTracking).not.toHaveBeenCalled();
  });

  it("throws when checkBatteryOptimization has not been called", async () => {
    useAsleepStore.setState({ hasCheckedStatus: true });
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow(/checkBatteryOptimization/);
  });

  it("throws when setup is in progress", async () => {
    useAsleepStore.setState({
      hasCheckedStatus: true,
      hasCheckedBatteryOptimization: true,
      isSetupInProgress: true,
    });
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow(/setup is in progress/);
  });

  it("throws when tracking already in progress", async () => {
    useAsleepStore.setState({
      hasCheckedStatus: true,
      hasCheckedBatteryOptimization: true,
      isTracking: true,
    });
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow(/already in progress/);
  });

  it("throws (no Alert.alert) when permission is denied", async () => {
    useAsleepStore.setState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    mockModule.requestRequiredPermissions.mockResolvedValueOnce(false);
    await expect(useAsleepStore.getState().startTracking()).rejects.toThrow(/Microphone/);
  });

  it("starts tracking when all prerequisites met", async () => {
    setPlatform("ios");
    useAsleepStore.setState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    await useAsleepStore.getState().startTracking();
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(true);
    expect(s.trackingStartTime).toBeInstanceOf(Date);
    expect(s.didClose).toBe(false);
    expect(mockModule.startTracking).toHaveBeenCalled();
  });
});

describe("stopTracking()", () => {
  beforeEach(resetStore);

  it("clears tracking state and stores returned sessionId", async () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true, trackingStartTime: new Date() });
    mockModule.stopTracking.mockResolvedValueOnce("session-xyz");
    await useAsleepStore.getState().stopTracking();
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.trackingStartTime).toBeNull();
    expect(s.didClose).toBe(true);
    expect(s.sessionId).toBe("session-xyz");
  });

  it("preserves existing sessionId when native returns falsy", async () => {
    useAsleepStore.setState({ isTracking: true, sessionId: "previous" });
    mockModule.stopTracking.mockResolvedValueOnce(undefined);
    await useAsleepStore.getState().stopTracking();
    expect(useAsleepStore.getState().sessionId).toBe("previous");
  });
});

describe("getReport()", () => {
  beforeEach(resetStore);

  it("converts snake_case keys to camelCase", async () => {
    mockModule.getReport.mockResolvedValueOnce({
      timezone: "Asia/Seoul",
      session: {
        id: "abc",
        created_timezone: "Asia/Seoul",
        start_time: "2026-01-01",
        state: "COMPLETE",
        sleep_stages: [1, 2, 3],
      },
      missing_data_ratio: 0.1,
      peculiarities: [],
    });
    const report = await useAsleepStore.getState().getReport("abc");
    expect(report?.session.id).toBe("abc");
    expect(report?.session.createdTimezone).toBe("Asia/Seoul");
    expect(report?.session.startTime).toBe("2026-01-01");
    expect(report?.session.sleepStages).toEqual([1, 2, 3]);
    expect(report?.missingDataRatio).toBe(0.1);
  });

  it("normalizes flat session-shaped responses into AsleepReport", async () => {
    mockModule.getReport.mockResolvedValueOnce({
      session_id: "flat-id",
      created_timezone: "UTC",
      session_start_time: "2026-01-01",
      session_end_time: "2026-01-02",
      state: "COMPLETE",
      sleep_stages: [0, 1],
    });
    const report = await useAsleepStore.getState().getReport("flat-id");
    expect(report?.session.id).toBe("flat-id");
    expect(report?.session.startTime).toBe("2026-01-01");
    expect(report?.session.endTime).toBe("2026-01-02");
    expect(report?.missingDataRatio).toBe(0);
  });

  it("returns null and stores error on failure", async () => {
    mockModule.getReport.mockRejectedValueOnce(new Error("fetch failed"));
    const report = await useAsleepStore.getState().getReport("any");
    expect(report).toBeNull();
    expect(useAsleepStore.getState().error).toBe("fetch failed");
  });
});

describe("getReportList()", () => {
  beforeEach(resetStore);

  it("normalizes each session to AsleepSession shape", async () => {
    mockModule.getReportList.mockResolvedValueOnce([
      {
        session_id: "s1",
        state: "COMPLETE",
        session_start_time: "2026-01-01",
        session_end_time: "2026-01-02",
        created_timezone: "UTC",
        time_in_bed: 480,
      },
    ]);
    const list = await useAsleepStore.getState().getReportList("from", "to");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "s1",
      state: "COMPLETE",
      startTime: "2026-01-01",
      endTime: "2026-01-02",
      createdTimezone: "UTC",
      timeInBed: 480,
    });
  });
});

describe("requestRequiredPermissions()", () => {
  beforeEach(resetStore);

  it("delegates to native on iOS", async () => {
    setPlatform("ios");
    mockModule.requestRequiredPermissions.mockResolvedValueOnce(true);
    const granted = await useAsleepStore.getState().requestRequiredPermissions();
    expect(granted).toBe(true);
    expect(mockModule.requestRequiredPermissions).toHaveBeenCalled();
  });

  it("requests RECORD_AUDIO and POST_NOTIFICATIONS on Android 33+", async () => {
    setPlatform("android", 33);
    const rn = require("react-native");
    rn.PermissionsAndroid.requestMultiple.mockResolvedValueOnce({
      RECORD_AUDIO: "granted",
      POST_NOTIFICATIONS: "granted",
    });
    const granted = await useAsleepStore.getState().requestRequiredPermissions();
    expect(granted).toBe(true);
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenCalledWith(["RECORD_AUDIO", "POST_NOTIFICATIONS"]);
  });

  it("requests only RECORD_AUDIO on Android <33", async () => {
    setPlatform("android", 31);
    const rn = require("react-native");
    rn.PermissionsAndroid.requestMultiple.mockResolvedValueOnce({ RECORD_AUDIO: "granted" });
    const granted = await useAsleepStore.getState().requestRequiredPermissions();
    expect(granted).toBe(true);
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenCalledWith(["RECORD_AUDIO"]);
  });

  it("returns false when audio is denied on Android", async () => {
    setPlatform("android", 33);
    const rn = require("react-native");
    rn.PermissionsAndroid.requestMultiple.mockResolvedValueOnce({
      RECORD_AUDIO: "denied",
      POST_NOTIFICATIONS: "granted",
    });
    const granted = await useAsleepStore.getState().requestRequiredPermissions();
    expect(granted).toBe(false);
  });
});

describe("addEventListener()", () => {
  beforeEach(resetStore);

  it("returns a cleanup function that detaches the listener", () => {
    const listener = jest.fn();
    const off = useAsleepStore.getState().addEventListener("onTrackingCreated", listener);
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
    off();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(0);
  });
});

describe("initializeAsleepListeners ref counting", () => {
  beforeEach(resetStore);

  it("first cleanup does not detach listeners while another holder is active", () => {
    const cleanupA = initializeAsleepListeners();
    const cleanupB = initializeAsleepListeners();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);

    cleanupA();
    // Holder B still active — native listener must remain attached.
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);

    cleanupB();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(0);
  });

  it("calling the same cleanup twice is a no-op", () => {
    const cleanupA = initializeAsleepListeners();
    const cleanupB = initializeAsleepListeners();
    cleanupA();
    cleanupA();
    // B should still be the active holder
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
    cleanupB();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(0);
  });

  it("re-initializes cleanly after final teardown", () => {
    const cleanup1 = initializeAsleepListeners();
    cleanup1();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(0);

    const cleanup2 = initializeAsleepListeners();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBeGreaterThan(0);
    cleanup2();
  });
});

describe("event handlers (initializeAsleepListeners)", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStore();
    cleanup = initializeAsleepListeners();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("onUserJoined stores userId", () => {
    mockEmitter.__emit("onUserJoined", { userId: "user-1" });
    expect(useAsleepStore.getState().userId).toBe("user-1");
  });

  it("onTrackingCreated sets isTracking and sessionId", () => {
    mockEmitter.__emit("onTrackingCreated", { sessionId: "sess-1" });
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(true);
    expect(s.sessionId).toBe("sess-1");
  });

  // The +1 in these tests is addLog: every event handler also writes to the
  // `log` field. The point of the batched setState in onTrackingCreated /
  // onTrackingClosed is to compress the multiple state writes into one — the
  // separate addLog notification is intrinsic to the logging design.
  it("onTrackingCreated produces 2 notifications (1 batched state + 1 log)", () => {
    const listener = jest.fn();
    useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onTrackingCreated", { sessionId: "sess-1" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("onTrackingClosed produces 2 notifications (1 batched state + 1 log)", () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true, trackingStartTime: new Date() });
    const listener = jest.fn();
    useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onTrackingClosed", { sessionId: "final" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("onTrackingClosed clears tracking state and stores sessionId", () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true, trackingStartTime: new Date() });
    mockEmitter.__emit("onTrackingClosed", { sessionId: "final-sess" });
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.didClose).toBe(true);
    expect(s.trackingStartTime).toBeNull();
    expect(s.sessionId).toBe("final-sess");
  });

  it("onTrackingFailed with terminal code clears tracking state", () => {
    useAsleepStore.setState({ isTracking: true, isAnalyzing: true });
    mockEmitter.__emit("onTrackingFailed", { code: "UPLOAD_TRACKING_TERMINATED", error: "x" });
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(false);
    expect(s.isAnalyzing).toBe(false);
    expect(s.didClose).toBe(true);
    expect(s.error).toContain("UPLOAD_TRACKING_TERMINATED");
  });

  it("onTrackingFailed with INTERRUPTION_RECOVERY_FAILED also clears state", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", { code: "INTERRUPTION_RECOVERY_FAILED", error: "x" });
    expect(useAsleepStore.getState().isTracking).toBe(false);
  });

  it("onTrackingFailed with non-terminal code keeps tracking flag", () => {
    useAsleepStore.setState({ isTracking: true });
    mockEmitter.__emit("onTrackingFailed", { code: "SOMETHING_ELSE", error: "minor" });
    const s = useAsleepStore.getState();
    expect(s.isTracking).toBe(true);
    expect(s.error).toContain("minor");
  });

  it("onTrackingResumed clears error unconditionally", () => {
    useAsleepStore.setState({ error: "old error", isTrackingPaused: false });
    mockEmitter.__emit("onTrackingResumed", undefined);
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("onTrackingResumed only flips paused flag when actually paused", () => {
    useAsleepStore.setState({ isTrackingPaused: true });
    mockEmitter.__emit("onTrackingResumed", undefined);
    expect(useAsleepStore.getState().isTrackingPaused).toBe(false);
  });

  it("onAnalysisResult stores result and clears isAnalyzing", () => {
    useAsleepStore.setState({ isAnalyzing: true });
    const data = { id: "a", state: "ANALYZING", sleepStages: [0, 1] };
    mockEmitter.__emit("onAnalysisResult", data);
    const s = useAsleepStore.getState();
    expect(s.analysisResult).toEqual(data);
    expect(s.isAnalyzing).toBe(false);
  });
});
