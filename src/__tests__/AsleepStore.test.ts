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

jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "RECORD_AUDIO", POST_NOTIFICATIONS: "POST_NOTIFICATIONS" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    requestMultiple: jest.fn().mockResolvedValue({ RECORD_AUDIO: "granted", POST_NOTIFICATIONS: "granted" }),
  },
}));

import { AsleepError } from "../Asleep.types";
import {
  asleepActions,
  initializeAsleepListeners,
  normalizeError,
  toPublicState,
  useAsleepStore,
  type InternalAsleepState,
} from "../AsleepStore";
import { setMockPlatform } from "./_helpers/factories.test";

const initialState = useAsleepStore.getState();
let cleanup: () => void;

const resetState = (partial: Partial<InternalAsleepState> = {}) => {
  useAsleepStore.setState({
    ...initialState,
    setupStatus: "idle",
    trackingStatus: "idle",
    sessionId: null,
    userId: null,
    error: null,
    analysisResult: null,
    isAnalyzing: false,
    didClose: false,
    isODAEnabled: false,
    trackingStartTime: null,
    isInitialized: false,
    hasCheckedStatus: false,
    hasCheckedBatteryOptimization: false,
    showDebugLog: false,
    log: "",
    ...partial,
  });
};

beforeAll(() => {
  cleanup = initializeAsleepListeners();
});

afterAll(() => cleanup());

beforeEach(() => {
  jest.clearAllMocks();
  setMockPlatform({ OS: "ios", Version: 17 });
  resetState();
});

describe("error normalization", () => {
  it("preserves native metadata without stringifying the payload", () => {
    const payload = { code: "NATIVE", detail: "failed", sdkCode: 22000, caseName: "create" };
    const error = normalizeError(payload, "FALLBACK");
    expect(error).toBeInstanceOf(AsleepError);
    expect(error).toMatchObject({
      code: "NATIVE",
      message: "failed",
      sdkCode: 22000,
      caseName: "create",
      cause: payload,
    });
  });

  it("returns an existing AsleepError unchanged when no overrides are supplied", () => {
    const error = new AsleepError("EXISTING", "message");
    expect(normalizeError(error, "FALLBACK")).toBe(error);
  });
});

describe("public projection", () => {
  it.each([
    ["idle", false, false, false],
    ["tracking", true, false, false],
    ["paused", true, true, false],
    ["recoveryRequired", true, false, true],
  ] as const)("derives %s consistently", (status, isTracking, isTrackingPaused, isRecoveryRequired) => {
    resetState({ trackingStatus: status });
    expect(toPublicState(useAsleepStore.getState())).toMatchObject({
      status,
      isTracking,
      isTrackingPaused,
      isRecoveryRequired,
    });
  });

  it("derives setup booleans and hides internal flags", () => {
    resetState({ setupStatus: "inProgress", hasCheckedStatus: true, showDebugLog: true });
    const state = toPublicState(useAsleepStore.getState());
    expect(state.isSetupInProgress).toBe(true);
    expect(state.isSetupComplete).toBe(false);
    expect(state).not.toHaveProperty("hasCheckedStatus");
    expect(state).not.toHaveProperty("showDebugLog");
    expect(state).not.toHaveProperty("trackingStartTime");
  });

  it("caches the projection for the same internal reference", () => {
    const internal = useAsleepStore.getState();
    expect(toPublicState(internal)).toBe(toPublicState(internal));
  });
});

describe("listener lifecycle", () => {
  it("attaches one native listener set for multiple holders", () => {
    const extraA = initializeAsleepListeners();
    const extraB = initializeAsleepListeners();
    expect(mockEmitter.addListener).not.toHaveBeenCalled();
    extraA();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(1);
    extraB();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(1);
  });

  it("caller cleanup is idempotent", () => {
    const extra = initializeAsleepListeners();
    extra();
    extra();
    expect(mockEmitter.__listenerCount("onTrackingCreated")).toBe(1);
  });
});

describe("one reducer transaction per native event", () => {
  const cases: Array<[string, unknown, Partial<InternalAsleepState>]> = [
    ["onUserJoined", { userId: "user" }, {}],
    ["onUserJoinFailed", { detail: "join failed", sdkCode: 10000 }, {}],
    ["onUserDeleted", { userId: "user" }, { userId: "old" }],
    ["onTrackingCreated", { sessionId: "session" }, {}],
    ["onTrackingUploaded", { sequence: 2 }, { trackingStatus: "tracking" }],
    ["onTrackingClosed", { sessionId: "session" }, { trackingStatus: "tracking" }],
    ["onTrackingFailed", { code: "TRACKING_FAILED", error: "failed", sdkCode: 23000 }, { trackingStatus: "tracking" }],
    ["onTrackingInterrupted", undefined, { trackingStatus: "tracking" }],
    ["onTrackingResumed", undefined, { trackingStatus: "paused", error: new AsleepError("OLD", "old") }],
    ["onMicPermissionDenied", undefined, {}],
    ["onDebugLog", { message: "native" }, {}],
    ["onSetupDidComplete", undefined, { setupStatus: "inProgress" }],
    ["onSetupDidFail", { error: "setup failed", sdkCode: 10000 }, { setupStatus: "inProgress" }],
    ["onSetupInProgress", { progress: 50 }, {}],
    ["onAnalysisResult", { sleep_stages: [1, 2] }, { isAnalyzing: true }],
  ];

  it.each(cases)("%s emits exactly once with debug logging enabled", async (event, payload, setup) => {
    resetState({ ...setup, showDebugLog: true });
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    mockEmitter.__emit(event, payload);
    await Promise.resolve();
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("no-op events emit zero times with debug logging disabled", () => {
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onMicPermissionDenied", undefined);
    mockEmitter.__emit("onDebugLog", { message: "ignored" });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("normalizes Android analysis casing", () => {
    mockEmitter.__emit("onAnalysisResult", { sleep_stages: [1], start_time: "now" });
    expect(useAsleepStore.getState().analysisResult).toEqual({ sleepStages: [1], startTime: "now" });
  });
});

describe("tracking failure classification", () => {
  beforeEach(() => resetState({ trackingStatus: "tracking", isAnalyzing: true, trackingStartTime: new Date() }));

  it("classifies recording-dead strings before the numeric terminal fallback", () => {
    mockEmitter.__emit("onTrackingFailed", {
      code: "AUDIO_INITIALIZATION_FAILED",
      message: "audio",
      sdkCode: 11003,
    });
    const state = useAsleepStore.getState();
    expect(state.error).toMatchObject({ category: "recordingDead", sdkCode: 11003 });
    expect(state.trackingStatus).toBe("idle");
    expect(state.didClose).toBe(false);
  });

  it("classifies recovery-required failures and keeps the session live", () => {
    mockEmitter.__emit("onTrackingFailed", {
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      message: "background",
      sdkCode: 11003,
    });
    const state = useAsleepStore.getState();
    expect(state.error?.category).toBe("recoveryRequired");
    expect(state.trackingStatus).toBe("recoveryRequired");
    expect(toPublicState(state).isTracking).toBe(true);
  });

  it("classifies terminal string and numeric codes", () => {
    mockEmitter.__emit("onTrackingFailed", {
      code: "TRACKING_FAILED",
      message: "terminal",
      sdkCode: 22500,
    });
    expect(useAsleepStore.getState()).toMatchObject({
      trackingStatus: "idle",
      didClose: true,
      isAnalyzing: false,
    });
    expect(useAsleepStore.getState().error?.category).toBe("terminal");
  });

  it("classifies survivable upload failures as transient without changing liveness", () => {
    mockEmitter.__emit("onTrackingFailed", {
      code: "TRACKING_FAILED",
      message: "retry exhausted",
      sdkCode: 23000,
    });
    expect(useAsleepStore.getState().error?.category).toBe("transient");
    expect(useAsleepStore.getState().trackingStatus).toBe("tracking");
  });

  it("classifies unknown codes without changing liveness", () => {
    mockEmitter.__emit("onTrackingFailed", { code: "NEW_CODE", message: "unknown", sdkCode: 34999 });
    expect(useAsleepStore.getState().error?.category).toBe("unknown");
    expect(useAsleepStore.getState().trackingStatus).toBe("tracking");
  });

  it("only a completed upload clears recovery-required state", () => {
    resetState({
      trackingStatus: "recoveryRequired",
      error: new AsleepError("RECOVERY", "needed", { category: "recoveryRequired" }),
    });
    mockEmitter.__emit("onTrackingResumed", undefined);
    expect(useAsleepStore.getState().trackingStatus).toBe("recoveryRequired");
    expect(useAsleepStore.getState().error).toBeNull();
    mockEmitter.__emit("onTrackingUploaded", { sequence: 2 });
    expect(useAsleepStore.getState().trackingStatus).toBe("tracking");
  });
});

describe("action contracts", () => {
  it("startTracking checks permission without requesting it", async () => {
    resetState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    await asleepActions.startTracking();
    expect(mockModule.hasRequiredPermissions).toHaveBeenCalledTimes(1);
    expect(mockModule.requestRequiredPermissions).not.toHaveBeenCalled();
    expect(mockModule.startTracking).toHaveBeenCalledTimes(1);
  });

  it("startTracking rejects denied permission with AsleepError", async () => {
    resetState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    mockModule.hasRequiredPermissions.mockResolvedValueOnce(false);
    await expect(asleepActions.startTracking()).rejects.toMatchObject({
      name: "AsleepError",
      code: "PERMISSION_DENIED",
    });
    expect(mockModule.startTracking).not.toHaveBeenCalled();
  });

  it("requestRequiredPermissions returns false for a normal Android denial", async () => {
    setMockPlatform({ OS: "android", Version: 34 });
    const { PermissionsAndroid } = require("react-native");
    PermissionsAndroid.requestMultiple.mockResolvedValueOnce({
      RECORD_AUDIO: "denied",
      POST_NOTIFICATIONS: "granted",
    });
    await expect(asleepActions.requestRequiredPermissions()).resolves.toBe(false);
    expect(useAsleepStore.getState().error).toBeNull();
  });

  it("requestRequiredPermissions still requests notifications but does not require them", async () => {
    setMockPlatform({ OS: "android", Version: 34 });
    const { PermissionsAndroid } = require("react-native");
    PermissionsAndroid.requestMultiple.mockResolvedValueOnce({
      RECORD_AUDIO: "granted",
      POST_NOTIFICATIONS: "denied",
    });
    await expect(asleepActions.requestRequiredPermissions()).resolves.toBe(true);
    expect(PermissionsAndroid.requestMultiple).toHaveBeenLastCalledWith([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ]);
  });

  it("initAsleepConfig stays callable while a restored session is tracking", async () => {
    resetState({ trackingStatus: "tracking" });
    await asleepActions.initAsleepConfig({ apiKey: "key" });
    expect(mockModule.initAsleepConfig).toHaveBeenCalledTimes(1);
    expect(useAsleepStore.getState().setupStatus).toBe("complete");
  });

  it("getReport throws REPORT_NOT_FOUND when native resolves no report", async () => {
    mockModule.getReport.mockResolvedValueOnce(null);
    await expect(asleepActions.getReport("session-1")).rejects.toMatchObject({ code: "REPORT_NOT_FOUND" });
    expect(useAsleepStore.getState().error).toMatchObject({ code: "REPORT_NOT_FOUND" });
  });

  it("getAverageReport throws REPORT_NOT_FOUND when native resolves no report", async () => {
    mockModule.getAverageReport.mockResolvedValueOnce(null);
    await expect(asleepActions.getAverageReport("2026-07-01", "2026-07-07")).rejects.toMatchObject({
      code: "REPORT_NOT_FOUND",
    });
  });

  it("getReportList treats a null native payload as an empty list", async () => {
    mockModule.getReportList.mockResolvedValueOnce(null);
    await expect(asleepActions.getReportList("2026-07-01", "2026-07-07")).resolves.toEqual([]);
  });

  it("requestRequiredPermissions normalizes a bridge failure", async () => {
    mockModule.requestRequiredPermissions.mockRejectedValueOnce(new Error("bridge failed"));
    await expect(asleepActions.requestRequiredPermissions()).rejects.toMatchObject({
      code: "REQUEST_PERMISSION_FAILED",
    });
    expect(useAsleepStore.getState().error).toBeInstanceOf(AsleepError);
  });

  it("startTracking enforces restore and battery prerequisites", async () => {
    await expect(asleepActions.startTracking()).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
    resetState({ hasCheckedStatus: true });
    await expect(asleepActions.startTracking()).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
  });

  it("resumeTracking rejects Android with a typed error", async () => {
    setMockPlatform({ OS: "android", Version: 34 });
    await expect(asleepActions.resumeTracking()).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" });
  });

  it.each([
    ["getReport", () => asleepActions.getReport("session")],
    ["getReportList", () => asleepActions.getReportList("2026-01-01", "2026-01-02")],
    ["getAverageReport", () => asleepActions.getAverageReport("2026-01-01", "2026-01-02")],
    ["deleteSession", () => asleepActions.deleteSession("session")],
    ["requestAnalysis", () => asleepActions.requestAnalysis()],
  ])("%s throws AsleepError rather than returning a sentinel", async (nativeName, call) => {
    (mockModule as any)[nativeName].mockRejectedValueOnce(new Error("native failure"));
    await expect(call()).rejects.toBeInstanceOf(AsleepError);
  });

  it("requestAnalysis return never writes analysisResult", async () => {
    mockModule.requestAnalysis.mockResolvedValueOnce({ sleep_stages: [1] });
    await expect(asleepActions.requestAnalysis()).resolves.toEqual({ sleepStages: [1] });
    expect(useAsleepStore.getState().analysisResult).toBeNull();
    expect(useAsleepStore.getState().isAnalyzing).toBe(true);
  });

  it("keeps a tracking failure emitted before lifecycle rejection", async () => {
    resetState({ hasCheckedStatus: true, hasCheckedBatteryOptimization: true });
    let rejectStart!: (error: Error) => void;
    mockModule.startTracking.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectStart = reject;
      }),
    );
    const promise = asleepActions.startTracking();
    await Promise.resolve();
    await Promise.resolve();
    mockEmitter.__emit("onTrackingFailed", {
      code: "TRACKING_FAILED",
      message: "classified",
      sdkCode: 22500,
    });
    const classified = useAsleepStore.getState().error;
    rejectStart(new Error("raw rejection"));
    await expect(promise).rejects.toBe(classified);
    expect(useAsleepStore.getState().error).toBe(classified);
  });

  it("query success does not clobber an error emitted during the await", async () => {
    const stale = new AsleepError("STALE", "stale");
    resetState({ error: stale, trackingStatus: "tracking" });
    let resolveReport!: (report: unknown) => void;
    mockModule.getReport.mockReturnValueOnce(new Promise((resolve) => (resolveReport = resolve)));
    const promise = asleepActions.getReport("session");
    mockEmitter.__emit("onTrackingFailed", {
      code: "TRACKING_FAILED",
      message: "concurrent",
      sdkCode: 23000,
    });
    const concurrent = useAsleepStore.getState().error;
    resolveReport({ timezone: "UTC", session: { id: "session" }, missingDataRatio: 0, peculiarities: [] });
    await promise;
    expect(useAsleepStore.getState().error).toBe(concurrent);
  });

  it("never pairs console.error with thrown failures", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockModule.getReport.mockRejectedValueOnce(new Error("failure"));
    await expect(asleepActions.getReport("session")).rejects.toBeInstanceOf(AsleepError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
