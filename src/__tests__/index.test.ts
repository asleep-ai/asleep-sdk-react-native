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
    RESULTS: { GRANTED: "granted" },
    requestMultiple: jest.fn().mockResolvedValue({ RECORD_AUDIO: "granted" }),
  },
}));

import * as publicApi from "../index";

describe("public API surface", () => {
  it("exports only the intended runtime values", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["Asleep", "AsleepError", "useAsleep"]);
    expect(typeof publicApi.AsleepError).toBe("function");
  });

  it("does not expose v1 surfaces", () => {
    expect((publicApi as any).default).toBeUndefined();
    expect((publicApi as any).AsleepSDK).toBeUndefined();
    expect((publicApi as any).asleepStore).toBeUndefined();
  });

  it("imports without attaching native listeners", () => {
    expect(mockEmitter.addListener).not.toHaveBeenCalled();
  });
});

describe("Asleep escape hatch", () => {
  it("has exactly four members", () => {
    expect(Object.keys(publicApi.Asleep).sort()).toEqual(["addEventListener", "getState", "initialize", "subscribe"]);
  });

  it("initializes the store bridge and cleans it up", () => {
    const cleanup = publicApi.Asleep.initialize();
    mockEmitter.__emit("onUserJoined", { userId: "user" });
    expect(publicApi.Asleep.getState().userId).toBe("user");
    cleanup();
  });

  it("getState exposes public actions but no internal facts", () => {
    const state = publicApi.Asleep.getState();
    expect(typeof state.startTracking).toBe("function");
    expect(typeof state.hasRequiredPermissions).toBe("function");
    expect(state).not.toHaveProperty("showDebugLog");
    expect(state).not.toHaveProperty("hasCheckedStatus");
  });

  it("subscribe ignores internal-only state changes", () => {
    const listener = jest.fn();
    const unsubscribe = publicApi.Asleep.subscribe(listener);
    publicApi.Asleep.getState().enableLog(true);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("subscribe receives public projection changes", () => {
    const cleanup = publicApi.Asleep.initialize();
    const listener = jest.fn();
    const unsubscribe = publicApi.Asleep.subscribe(listener);
    mockEmitter.__emit("onTrackingCreated", { sessionId: "session" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].sessionId).toBe("session");
    unsubscribe();
    cleanup();
  });

  it("addEventListener forwards to the emitter and returns cleanup", () => {
    const listener = jest.fn();
    const unsubscribe = publicApi.Asleep.addEventListener("onTrackingCreated", listener);
    mockEmitter.__emit("onTrackingCreated", { sessionId: "session" });
    expect(listener).toHaveBeenCalledWith({ sessionId: "session" });
    unsubscribe();
    listener.mockClear();
    mockEmitter.__emit("onTrackingCreated", { sessionId: "later" });
    expect(listener).not.toHaveBeenCalled();
  });
});
