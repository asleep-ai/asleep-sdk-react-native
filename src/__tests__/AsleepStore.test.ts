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
    isUserConfigReady: false,
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

  it("splits an encoded native rejection code into code and sdkCode", () => {
    const rejection = Object.assign(new Error("server said no"), { code: "REANALYZE_FAILED:30409" });
    expect(normalizeError(rejection, "FALLBACK")).toMatchObject({
      code: "REANALYZE_FAILED",
      sdkCode: 30409,
      message: "server said no",
      cause: rejection,
    });
  });

  it("leaves unencoded native rejection codes unchanged", () => {
    const rejection = Object.assign(new Error("x"), { code: "ERR_UNEXPECTED" });
    expect(normalizeError(rejection, "FALLBACK")).toMatchObject({ code: "ERR_UNEXPECTED", sdkCode: undefined });
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

  it("classifies iOS interruption-recovery exhaustion as recording-dead with the session still open", () => {
    mockEmitter.__emit("onTrackingFailed", {
      code: "INTERRUPTION_RECOVERY_FAILED",
      message: "recovery failed",
      sdkCode: 11007,
    });
    const state = useAsleepStore.getState();
    expect(state.error?.category).toBe("recordingDead");
    expect(state.trackingStatus).toBe("idle");
    expect(state.didClose).toBe(false);
  });

  it.each([22400, 11403, 11404, 11008])("classifies start failure %i as terminal and leaves tracking", (sdkCode) => {
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    mockEmitter.__emit("onTrackingFailed", { code: "UNKNOWN_ERROR", message: "start failed", sdkCode });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAsleepStore.getState()).toMatchObject({ trackingStatus: "idle", trackingStartTime: null });
    expect(useAsleepStore.getState().error).toMatchObject({ category: "terminal", sdkCode });
  });

  it("keeps the live session for iOS alreadyTracking (11010)", () => {
    mockEmitter.__emit("onTrackingFailed", { code: "UNKNOWN_ERROR", message: "already tracking", sdkCode: 11010 });
    expect(useAsleepStore.getState().error?.category).toBe("unknown");
    expect(useAsleepStore.getState().trackingStatus).toBe("tracking");
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

describe("credentials", () => {
  it("setup forwards an API key without token fields", async () => {
    await asleepActions.setup({ apiKey: "key", baseUrl: "https://api", service: "svc", enableODA: true });
    expect(mockModule.setup).toHaveBeenCalledWith({ apiKey: "key" }, "https://api", undefined, "svc", true, null);
  });

  it("setup forwards appId/appSecret token credentials", async () => {
    await asleepActions.setup({ appId: "app", appSecret: "secret" });
    expect(mockModule.setup).toHaveBeenCalledWith(
      { appId: "app", appSecret: "secret" },
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    );
    expect(useAsleepStore.getState().setupStatus).toBe("complete");
  });

  it("initAsleepConfig forwards token credentials and userId", async () => {
    await asleepActions.initAsleepConfig({ appId: "app", appSecret: "secret", userId: "user" });
    expect(mockModule.initAsleepConfig).toHaveBeenCalledWith(undefined, "app", "secret", "user", undefined, undefined);
  });

  it("initAsleepConfig forwards an API key", async () => {
    await asleepActions.initAsleepConfig({ apiKey: "key", userId: "user" });
    expect(mockModule.initAsleepConfig).toHaveBeenCalledWith("key", undefined, undefined, "user", undefined, undefined);
  });

  const invalid: Array<[string, unknown]> = [
    ["neither form", {}],
    ["both forms", { apiKey: "key", appId: "app", appSecret: "secret" }],
    ["apiKey with appId only", { apiKey: "key", appId: "app" }],
    ["appId without appSecret", { appId: "app" }],
    ["appSecret without appId", { appSecret: "secret" }],
    ["empty apiKey", { apiKey: "" }],
    ["empty appSecret", { appId: "app", appSecret: "" }],
  ];

  it.each(invalid)("setup rejects %s with INVALID_ARGUMENT before native", async (_name, config) => {
    await expect(asleepActions.setup(config as any)).rejects.toMatchObject({
      name: "AsleepError",
      code: "INVALID_ARGUMENT",
    });
    expect(mockModule.setup).not.toHaveBeenCalled();
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "idle", error: { code: "INVALID_ARGUMENT" } });
  });

  it.each(invalid)("initAsleepConfig rejects %s with INVALID_ARGUMENT before native", async (_name, config) => {
    await expect(asleepActions.initAsleepConfig(config as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mockModule.initAsleepConfig).not.toHaveBeenCalled();
    expect(useAsleepStore.getState().setupStatus).toBe("idle");
  });

  it("an invalid-credential rejection notifies subscribers exactly once", async () => {
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await expect(asleepActions.setup({} as any)).rejects.toBeInstanceOf(AsleepError);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
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

describe("user metadata", () => {
  const metadata = {
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 17,
    gender: "female",
    height: 165.5,
    weight: 55.2,
  } as const;

  const countNotifications = async (call: () => Promise<unknown>) => {
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await call().catch(() => undefined);
    unsubscribe();
    return listener.mock.calls.length;
  };

  it("saveUserMetadata forwards only provided fields and resolves void", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await expect(asleepActions.saveUserMetadata({ ...metadata, weight: undefined })).resolves.toBeUndefined();
    expect(mockModule.saveUserMetadata).toHaveBeenCalledWith({
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 17,
      gender: "female",
      height: 165.5,
    });
  });

  it("saveUserMetadata success does not notify subscribers", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    expect(await countNotifications(() => asleepActions.saveUserMetadata(metadata))).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["birthYear below range", { birthYear: 1899 }],
    ["birthYear above range", { birthYear: 2101 }],
    ["non-integer birthYear", { birthYear: 1990.5 }],
    ["birthMonth 0", { birthMonth: 0 }],
    ["birthMonth 13", { birthMonth: 13 }],
    ["birthDay 32", { birthDay: 32 }],
    ["string birthDay", { birthDay: "17" }],
    ["unknown gender", { gender: "unknown" }],
    ["height below range", { height: 0.5 }],
    ["height above range", { height: 500.1 }],
    ["NaN height", { height: Number.NaN }],
    ["weight above range", { weight: 1000.1 }],
    ["weight below range", { weight: 0 }],
  ])("saveUserMetadata rejects %s with INVALID_ARGUMENT before native", async (_name, invalid) => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await expect(asleepActions.saveUserMetadata(invalid as any)).rejects.toMatchObject({
      name: "AsleepError",
      code: "INVALID_ARGUMENT",
    });
    expect(mockModule.saveUserMetadata).not.toHaveBeenCalled();
    expect(useAsleepStore.getState().error).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("saveUserMetadata rejects a non-object argument before native", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await expect(asleepActions.saveUserMetadata(null as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mockModule.saveUserMetadata).not.toHaveBeenCalled();
  });

  it("accepts range boundaries", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await asleepActions.saveUserMetadata({ birthYear: 1900, birthMonth: 12, birthDay: 31, height: 1, weight: 1000 });
    await asleepActions.saveUserMetadata({ birthYear: 2100, birthMonth: 1, birthDay: 1, height: 500, weight: 1 });
    expect(mockModule.saveUserMetadata).toHaveBeenCalledTimes(2);
  });

  it("an invalid-metadata rejection notifies subscribers exactly once", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    expect(await countNotifications(() => asleepActions.saveUserMetadata({ birthMonth: 13 }))).toBe(1);
  });

  it.each([
    ["saveUserMetadata", () => asleepActions.saveUserMetadata(metadata)],
    ["fetchUserMetadata", () => asleepActions.fetchUserMetadata()],
  ])("%s rejects MISSING_PREREQUISITE before initAsleepConfig", async (nativeName, call) => {
    await expect(call()).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
    expect((mockModule as any)[nativeName]).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_ARGUMENT:27400", "INVALID_ARGUMENT", 27400],
    ["SAVE_USER_METADATA_FAILED:27000", "SAVE_USER_METADATA_FAILED", 27000],
  ])("saveUserMetadata preserves the native SDK code from %s", async (nativeCode, code, sdkCode) => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    const rejection = Object.assign(new Error("native"), { code: nativeCode });
    mockModule.saveUserMetadata.mockRejectedValueOnce(rejection);
    await expect(asleepActions.saveUserMetadata(metadata)).rejects.toMatchObject({
      code,
      sdkCode,
      message: "native",
      cause: rejection,
    });
    expect(useAsleepStore.getState().error).toMatchObject({ code, sdkCode });
  });

  it("a native save failure notifies subscribers exactly once", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.saveUserMetadata.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "SAVE_USER_METADATA_FAILED:27000" }),
    );
    expect(await countNotifications(() => asleepActions.saveUserMetadata(metadata))).toBe(1);
  });

  it("fetchUserMetadata normalizes Android snake_case keys", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.fetchUserMetadata.mockResolvedValueOnce({ birth_year: 1990, birth_month: 5, gender: "non_binary" });
    await expect(asleepActions.fetchUserMetadata()).resolves.toEqual({
      birthYear: 1990,
      birthMonth: 5,
      gender: "non_binary",
    });
  });

  it("fetchUserMetadata resolves null when nothing was saved", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await expect(asleepActions.fetchUserMetadata()).resolves.toBeNull();
  });

  it("fetchUserMetadata success does not notify subscribers", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    expect(await countNotifications(() => asleepActions.fetchUserMetadata())).toBe(0);
  });

  it("fetchUserMetadata preserves the native SDK code", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.fetchUserMetadata.mockRejectedValueOnce(
      Object.assign(new Error("fetch failed"), { code: "FETCH_USER_METADATA_FAILED:27100" }),
    );
    await expect(asleepActions.fetchUserMetadata()).rejects.toMatchObject({
      code: "FETCH_USER_METADATA_FAILED",
      sdkCode: 27100,
    });
  });

  it("fetchUserMetadata falls back to its own code for an unencoded rejection", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.fetchUserMetadata.mockRejectedValueOnce(new Error("bridge"));
    const error = await asleepActions.fetchUserMetadata().catch((e) => e);
    expect(error).toMatchObject({ code: "FETCH_USER_METADATA_FAILED", sdkCode: undefined });
  });
});

describe("stopTracking analysis range", () => {
  const start = new Date("2026-11-18T00:00:00.000Z");
  const end = new Date("2026-11-18T06:30:00.000Z");

  it("keeps the zero-argument native call when no range is supplied", async () => {
    resetState({ trackingStatus: "tracking" });
    await asleepActions.stopTracking();
    await asleepActions.stopTracking({});
    expect(mockModule.stopTracking).toHaveBeenCalledTimes(2);
    expect(mockModule.stopTracking.mock.calls).toEqual([[], []]);
  });

  it("forwards the range as epoch milliseconds and closes like a plain stop", async () => {
    resetState({ trackingStatus: "tracking", sessionId: "session-1" });
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await asleepActions.stopTracking({ analysisRange: { start, end } });
    unsubscribe();
    expect(mockModule.stopTracking).toHaveBeenCalledWith(start.getTime(), end.getTime());
    expect(useAsleepStore.getState()).toMatchObject({ trackingStatus: "idle", didClose: true, isAnalyzing: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown]>([
    ["start equal to end", { start, end: new Date(start.getTime()) }],
    ["start after end", { start: end, end: start }],
    ["start and end within the same second", { start, end: new Date(start.getTime() + 999) }],
    ["an invalid Date", { start: new Date(Number.NaN), end }],
    ["a non-Date bound", { start: start.toISOString(), end }],
    ["a missing end", { start }],
  ])("rejects %s with INVALID_ARGUMENT before native", async (_name, analysisRange) => {
    resetState({ trackingStatus: "tracking" });
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await expect(asleepActions.stopTracking({ analysisRange } as any)).rejects.toMatchObject({
      name: "AsleepError",
      code: "INVALID_ARGUMENT",
    });
    unsubscribe();
    expect(mockModule.stopTracking).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAsleepStore.getState()).toMatchObject({
      trackingStatus: "tracking",
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  it("accepts bounds exactly one whole second apart", async () => {
    resetState({ trackingStatus: "tracking" });
    await asleepActions.stopTracking({ analysisRange: { start: new Date(1999), end: new Date(2000) } });
    expect(mockModule.stopTracking).toHaveBeenCalledWith(1999, 2000);
  });
});

describe("reanalyze", () => {
  const start = new Date("2026-11-18T00:00:00.000Z");
  const end = new Date("2026-11-18T06:30:00.000Z");

  it("passes explicit nulls when no range is supplied", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await expect(asleepActions.reanalyze("session-1")).resolves.toBeUndefined();
    expect(mockModule.reanalyze).toHaveBeenCalledWith("session-1", null, null);
  });

  it("forwards the range as epoch milliseconds", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    await asleepActions.reanalyze("session-1", { analysisRange: { start, end } });
    expect(mockModule.reanalyze).toHaveBeenCalledWith("session-1", start.getTime(), end.getTime());
  });

  it("success does not notify subscribers or touch tracking state", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true, sessionId: "current", didClose: true });
    const before = useAsleepStore.getState();
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await asleepActions.reanalyze("session-1");
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(useAsleepStore.getState()).toBe(before);
  });

  it.each<[string, unknown, unknown]>([
    ["an empty sessionId", "", undefined],
    ["a blank sessionId", "   ", undefined],
    ["a non-string sessionId", 42, undefined],
    ["start equal to end", "session-1", { analysisRange: { start, end: new Date(start.getTime()) } }],
    ["start after end", "session-1", { analysisRange: { start: end, end: start } }],
    ["bounds within one second", "session-1", { analysisRange: { start, end: new Date(start.getTime() + 500) } }],
    ["an invalid Date", "session-1", { analysisRange: { start, end: new Date("nope") } }],
  ])("rejects %s with INVALID_ARGUMENT before native", async (_name, sessionId, options) => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await expect(asleepActions.reanalyze(sessionId as any, options as any)).rejects.toMatchObject({
      name: "AsleepError",
      code: "INVALID_ARGUMENT",
    });
    unsubscribe();
    expect(mockModule.reanalyze).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects MISSING_PREREQUISITE before initAsleepConfig", async () => {
    await expect(asleepActions.reanalyze("session-1")).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
    expect(mockModule.reanalyze).not.toHaveBeenCalled();
  });

  it.each([30000, 30400, 30401, 30403, 30404, 30409, 30410, 30422, 30500])(
    "preserves native sdkCode %i",
    async (sdkCode) => {
      resetState({ setupStatus: "complete", isUserConfigReady: true });
      mockModule.reanalyze.mockRejectedValueOnce(
        Object.assign(new Error("reanalyze failed"), { code: `REANALYZE_FAILED:${sdkCode}` }),
      );
      const listener = jest.fn();
      const unsubscribe = useAsleepStore.subscribe(listener);
      await expect(asleepActions.reanalyze("session-1")).rejects.toMatchObject({ code: "REANALYZE_FAILED", sdkCode });
      unsubscribe();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(useAsleepStore.getState().error).toMatchObject({ code: "REANALYZE_FAILED", sdkCode });
    },
  );

  it("passes a native MISSING_PREREQUISITE rejection through", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.reanalyze.mockRejectedValueOnce(
      Object.assign(new Error("no reports"), { code: "MISSING_PREREQUISITE" }),
    );
    await expect(asleepActions.reanalyze("session-1")).rejects.toMatchObject({
      code: "MISSING_PREREQUISITE",
      sdkCode: undefined,
    });
  });

  it("keeps a tracking failure emitted during the await", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true, trackingStatus: "tracking" });
    let resolveNative!: () => void;
    mockModule.reanalyze.mockReturnValueOnce(new Promise<void>((resolve) => (resolveNative = resolve)));
    const promise = asleepActions.reanalyze("session-1");
    mockEmitter.__emit("onTrackingFailed", { code: "TRACKING_FAILED", message: "concurrent", sdkCode: 23000 });
    const concurrent = useAsleepStore.getState().error;
    resolveNative();
    await promise;
    expect(useAsleepStore.getState().error).toBe(concurrent);
  });
});

describe("user config readiness", () => {
  it("onUserDeleted clears readiness so per-user actions reject before native", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true, userId: "A" });
    mockEmitter.__emit("onUserDeleted", { userId: "A" });
    expect(useAsleepStore.getState().isUserConfigReady).toBe(false);
    await expect(asleepActions.fetchUserMetadata()).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
    expect(mockModule.fetchUserMetadata).not.toHaveBeenCalled();
  });

  const userConfigCalls: Array<[string, () => Promise<unknown>]> = [
    ["saveUserMetadata", () => asleepActions.saveUserMetadata({ birthYear: 1990 })],
    ["fetchUserMetadata", () => asleepActions.fetchUserMetadata()],
    ["reanalyze", () => asleepActions.reanalyze("session-1")],
  ];

  const expectAllRejectBeforeNative = async () => {
    for (const [nativeName, call] of userConfigCalls) {
      await expect(call()).rejects.toMatchObject({ code: "MISSING_PREREQUISITE" });
      expect((mockModule as any)[nativeName]).not.toHaveBeenCalled();
    }
  };

  const expectAllReachNative = async () => {
    for (const [nativeName, call] of userConfigCalls) {
      await call();
      expect((mockModule as any)[nativeName]).toHaveBeenCalledTimes(1);
    }
  };

  // Both platforms resolve initAsleepConfig() only after the native user join;
  // iOS emits onUserJoined just before resolving with { userId }.
  const deferNativeInit = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    mockModule.initAsleepConfig.mockReturnValueOnce(
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    return { resolve: (value: unknown) => resolve(value), reject: (error: unknown) => reject(error) };
  };

  it("iOS: enables user-config calls only when initAsleepConfig resolves after the join", async () => {
    const native = deferNativeInit();
    const pending = asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    expect(useAsleepStore.getState().setupStatus).toBe("inProgress");
    await expectAllRejectBeforeNative();
    mockEmitter.__emit("onUserJoined", { userId: "A" });
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "inProgress", isUserConfigReady: false });
    await expectAllRejectBeforeNative();
    native.resolve({ userId: "A" });
    await pending;
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "complete", isUserConfigReady: true, userId: "A" });
    await expectAllReachNative();
  });

  it("Android: enables user-config calls when initAsleepConfig resolves with a userId", async () => {
    setMockPlatform({ OS: "android", Version: 34 });
    mockModule.initAsleepConfig.mockResolvedValueOnce({ userId: "A" });
    await asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    await expectAllReachNative();
  });

  it("a second initAsleepConfig during the join rejects OPERATION_IN_PROGRESS before native", async () => {
    const native = deferNativeInit();
    const pending = asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    await expect(asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" })).rejects.toMatchObject({
      code: "OPERATION_IN_PROGRESS",
    });
    expect(mockModule.initAsleepConfig).toHaveBeenCalledTimes(1);
    native.resolve({ userId: "A" });
    await pending;
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "complete", isUserConfigReady: true });
  });

  it("a stale onUserJoined for A during B's init does not enable readiness", async () => {
    mockModule.initAsleepConfig.mockResolvedValueOnce({ userId: "A" });
    await asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    expect(useAsleepStore.getState().isUserConfigReady).toBe(true);

    const native = deferNativeInit();
    const pending = asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" });
    mockEmitter.__emit("onUserJoined", { userId: "A" });
    expect(useAsleepStore.getState().isUserConfigReady).toBe(false);
    await expectAllRejectBeforeNative();

    mockEmitter.__emit("onUserJoined", { userId: "B" });
    native.resolve({ userId: "B" });
    await pending;
    expect(useAsleepStore.getState()).toMatchObject({ isUserConfigReady: true, userId: "B" });
  });

  it("onUserJoined outside an init (SDK-initiated join) enables readiness", () => {
    resetState({ setupStatus: "complete" });
    mockEmitter.__emit("onUserJoined", { userId: "A" });
    expect(useAsleepStore.getState()).toMatchObject({ isUserConfigReady: true, userId: "A" });
  });

  it("iOS: a failed re-init for user B rejects and never runs user A's config", async () => {
    mockModule.initAsleepConfig.mockResolvedValueOnce({ userId: "A" });
    await asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    expect(useAsleepStore.getState().isUserConfigReady).toBe(true);

    const native = deferNativeInit();
    const pending = asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" });
    await expectAllRejectBeforeNative();
    mockEmitter.__emit("onUserJoinFailed", { error: "join failed", caseName: "httpStatus", sdkCode: 10000 });
    const joinError = useAsleepStore.getState().error;
    native.reject(Object.assign(new Error("join failed"), { code: "INITIALIZATION_FAILED:10000" }));
    await expect(pending).rejects.toBe(joinError);
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "idle", isUserConfigReady: false });
    await expectAllRejectBeforeNative();
  });

  it("Android: a failed re-init for user B never runs user A's config", async () => {
    setMockPlatform({ OS: "android", Version: 34 });
    mockModule.initAsleepConfig.mockResolvedValueOnce({ userId: "A" });
    await asleepActions.initAsleepConfig({ apiKey: "key", userId: "A" });
    expect(useAsleepStore.getState().isUserConfigReady).toBe(true);

    mockModule.initAsleepConfig.mockImplementationOnce(async () => {
      mockEmitter.__emit("onUserJoinFailed", { errorCode: 10000, detail: "join failed", sdkCode: 10000 });
      throw Object.assign(new Error("Initialization failed"), { code: "INITIALIZATION_FAILED" });
    });
    await expect(asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" })).rejects.toBeDefined();
    await expectAllRejectBeforeNative();
  });

  it("invalidates the config while a re-init is in progress", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    let resolveNative!: (value: unknown) => void;
    mockModule.initAsleepConfig.mockReturnValueOnce(new Promise((resolve) => (resolveNative = resolve)));
    const pending = asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" });
    await expectAllRejectBeforeNative();
    resolveNative(undefined);
    await pending;
    expect(useAsleepStore.getState().isUserConfigReady).toBe(false);
  });

  it("a rejected initAsleepConfig clears readiness", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockModule.initAsleepConfig.mockRejectedValueOnce(new Error("bridge"));
    await expect(asleepActions.initAsleepConfig({ apiKey: "key", userId: "B" })).rejects.toBeDefined();
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "idle", isUserConfigReady: false });
  });

  it("onUserJoinFailed disables user-config calls", async () => {
    resetState({ setupStatus: "complete", isUserConfigReady: true });
    mockEmitter.__emit("onUserJoinFailed", { error: "join failed", sdkCode: 10000 });
    await expectAllRejectBeforeNative();
  });

  it.each([false, true])(
    "onUserJoined and onUserJoinFailed notify exactly once each (debug logging %s)",
    (showDebugLog) => {
      resetState({ showDebugLog });
      const listener = jest.fn();
      const unsubscribe = useAsleepStore.subscribe(listener);
      mockEmitter.__emit("onUserJoined", { userId: "A" });
      expect(listener).toHaveBeenCalledTimes(1);
      mockEmitter.__emit("onUserJoinFailed", { error: "join failed", sdkCode: 10000 });
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
    },
  );

  it.each([false, true])(
    "onUserJoined and onUserJoinFailed notify exactly once each during an init (debug logging %s)",
    (showDebugLog) => {
      resetState({ showDebugLog, setupStatus: "inProgress" });
      const listener = jest.fn();
      const unsubscribe = useAsleepStore.subscribe(listener);
      mockEmitter.__emit("onUserJoined", { userId: "A" });
      expect(listener).toHaveBeenCalledTimes(1);
      mockEmitter.__emit("onUserJoinFailed", { error: "join failed", sdkCode: 10000 });
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
    },
  );
});

describe("setup productInfo", () => {
  const productInfo = { model: "SleepHub-1", identifierType: "serial", identifierValue: "SN-0001" } as const;

  it.each<[string, Record<string, string>]>([
    ["apiKey", { apiKey: "key" }],
    ["appId/appSecret", { appId: "app", appSecret: "secret" }],
  ])("forwards productInfo with %s credentials", async (_name, credentials) => {
    await asleepActions.setup({ ...credentials, productInfo } as any);
    expect(mockModule.setup).toHaveBeenCalledWith(credentials, undefined, undefined, undefined, undefined, productInfo);
    expect(useAsleepStore.getState().setupStatus).toBe("complete");
  });

  it("forwards a mac_address identifier unchanged", async () => {
    const mac = { model: " M ", identifierType: "mac_address", identifierValue: "AA:BB:CC:DD:EE:FF" } as const;
    await asleepActions.setup({ apiKey: "key", productInfo: mac });
    expect(mockModule.setup.mock.calls[0][5]).toEqual(mac);
  });

  it.each([
    ["omitted", undefined],
    ["null", null],
  ])("forwards null when productInfo is %s", async (_name, value) => {
    await asleepActions.setup({ apiKey: "key", productInfo: value as any });
    expect(mockModule.setup.mock.calls[0][5]).toBeNull();
  });

  it("accepts length boundaries", async () => {
    await asleepActions.setup({
      apiKey: "key",
      productInfo: { model: "m".repeat(100), identifierType: "serial", identifierValue: "v".repeat(255) },
    });
    expect(mockModule.setup).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown]>([
    ["a non-object", "SN-0001"],
    ["an array", []],
    ["a missing model", { identifierType: "serial", identifierValue: "SN" }],
    ["an empty model", { ...productInfo, model: "" }],
    ["a blank model", { ...productInfo, model: " \t\n " }],
    ["a 101-character model", { ...productInfo, model: "m".repeat(101) }],
    ["a non-string model", { ...productInfo, model: 1 }],
    ["a missing identifierValue", { model: "M", identifierType: "serial" }],
    ["a blank identifierValue", { ...productInfo, identifierValue: "   " }],
    ["a 256-character identifierValue", { ...productInfo, identifierValue: "v".repeat(256) }],
    ["a missing identifierType", { model: "M", identifierValue: "SN" }],
    ["an unknown identifierType", { ...productInfo, identifierType: "imei" }],
    ["the native enum spelling", { ...productInfo, identifierType: "MAC_ADDRESS" }],
    ["an unknown field", { ...productInfo, serial: "SN" }],
  ])("rejects %s with INVALID_ARGUMENT before native", async (_name, invalid) => {
    await expect(asleepActions.setup({ apiKey: "key", productInfo: invalid as any })).rejects.toMatchObject({
      name: "AsleepError",
      code: "INVALID_ARGUMENT",
    });
    expect(mockModule.setup).not.toHaveBeenCalled();
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "idle", error: { code: "INVALID_ARGUMENT" } });
  });

  it("an invalid-productInfo rejection notifies subscribers exactly once", async () => {
    const listener = jest.fn();
    const unsubscribe = useAsleepStore.subscribe(listener);
    await asleepActions.setup({ apiKey: "key", productInfo: { ...productInfo, model: "" } }).catch(() => undefined);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // iOS also sends `code`, the Swift enum ordinal; its value here is arbitrary.
  it.each([
    [
      "iOS rejected (13400)",
      { error: "Product registration rejected", caseName: "productRegisterRejected", code: 61, sdkCode: 13400 },
    ],
    [
      "iOS transient (13000)",
      { error: "Failed to register a product", caseName: "productRegisterFailed", code: 60, sdkCode: 13000 },
    ],
    ["Android rejected (13400)", { error: "Invalid model: must not be empty", sdkCode: 13400 }],
    ["Android transient (13000)", { error: "network error", sdkCode: 13000 }],
  ])("onSetupDidFail for %s keeps sdkCode and resets setup", (_name, payload) => {
    resetState({ setupStatus: "complete", isInitialized: true });
    mockEmitter.__emit("onSetupDidFail", payload);
    expect(useAsleepStore.getState()).toMatchObject({
      setupStatus: "idle",
      error: { name: "AsleepError", code: "SETUP_FAILED", sdkCode: payload.sdkCode, message: payload.error },
    });
  });

  it.each([13400, 13000])("an Android setup rejection carrying %i keeps sdkCode", async (sdkCode) => {
    const rejection = Object.assign(new Error(`Setup failed: ${sdkCode} - detail`), {
      code: `SETUP_FAILED:${sdkCode}`,
    });
    mockModule.setup.mockRejectedValueOnce(rejection);
    await expect(asleepActions.setup({ apiKey: "key", productInfo })).rejects.toMatchObject({
      code: "SETUP_FAILED",
      sdkCode,
      cause: rejection,
    });
    expect(useAsleepStore.getState()).toMatchObject({ setupStatus: "idle", error: { code: "SETUP_FAILED", sdkCode } });
  });

  it("throws the event error published while the Android setup promise was pending", async () => {
    mockModule.setup.mockImplementationOnce(async () => {
      mockEmitter.__emit("onSetupDidFail", { error: "rejected", sdkCode: 13400 });
      throw Object.assign(new Error("Setup failed: 13400 - rejected"), { code: "SETUP_FAILED:13400" });
    });
    const error = await asleepActions.setup({ apiKey: "key", productInfo }).catch((e) => e);
    expect(error).toBe(useAsleepStore.getState().error);
    expect(error).toMatchObject({ code: "SETUP_FAILED", sdkCode: 13400, message: "rejected" });
  });
});
