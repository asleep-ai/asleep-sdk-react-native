/**
 * Public API surface tests for src/index.ts. Verifies that the v2.0
 * consolidation only exposes `useAsleep`, `Asleep`, and types — and that
 * removed legacy surfaces stay removed.
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

jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "RECORD_AUDIO", POST_NOTIFICATIONS: "POST_NOTIFICATIONS" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    requestMultiple: jest.fn().mockResolvedValue({ RECORD_AUDIO: "granted" }),
  },
}));

import * as publicApi from "../index";

describe("public API surface (v2.0)", () => {
  it("exports useAsleep and Asleep, and nothing else as runtime value", () => {
    expect(typeof publicApi.useAsleep).toBe("function");
    expect(typeof publicApi.Asleep).toBe("object");

    const runtimeKeys = Object.keys(publicApi).filter((k) => typeof (publicApi as any)[k] !== "undefined");
    expect(runtimeKeys.sort()).toEqual(["Asleep", "useAsleep"]);
  });

  it("does not expose the removed v1.x surfaces", () => {
    expect((publicApi as any).default).toBeUndefined();
    expect((publicApi as any).AsleepSDK).toBeUndefined();
    expect((publicApi as any).asleepStore).toBeUndefined();
  });
});

describe("Asleep escape hatch", () => {
  it("exposes only initialize, getState, subscribe, addEventListener", () => {
    expect(Object.keys(publicApi.Asleep).sort()).toEqual(["addEventListener", "getState", "initialize", "subscribe"]);
  });

  it("initialize attaches native event listeners that flow into the store", () => {
    const cleanup = publicApi.Asleep.initialize();
    mockEmitter.__emit("onUserJoined", { userId: "from-escape-hatch" });
    expect(publicApi.Asleep.getState().userId).toBe("from-escape-hatch");
    cleanup();
  });

  it("getState returns the current store state", () => {
    const snapshot = publicApi.Asleep.getState();
    expect(snapshot).toHaveProperty("isTracking");
    expect(snapshot).toHaveProperty("userId");
    expect(snapshot).toHaveProperty("sessionId");
  });

  it("subscribe is notified after a state change and unsubscribe stops it", () => {
    const listener = jest.fn();
    const off = publicApi.Asleep.subscribe(listener);
    publicApi.Asleep.getState().enableLog(true);
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    off();
    publicApi.Asleep.getState().enableLog(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("narrows internal setters out of the escape hatch's public type", () => {
    const state = publicApi.Asleep.getState();
    // Runtime still has these (they back the store), but the public type
    // hides them so TypeScript users cannot accidentally mutate SDK state.
    // @ts-expect-error setIsTracking is intentionally not part of AsleepPublicState
    void state.setIsTracking;
    // @ts-expect-error setError is intentionally not part of AsleepPublicState
    void state.setError;
    // @ts-expect-error addLog is intentionally not part of AsleepPublicState
    void state.addLog;
    expect(state).toBeDefined();
  });

  it("addEventListener forwards to the native emitter and returns a cleanup", () => {
    const handler = jest.fn();
    const off = publicApi.Asleep.addEventListener("onTrackingCreated", handler);
    mockEmitter.__emit("onTrackingCreated", { sessionId: "esc" });
    expect(handler).toHaveBeenCalledWith({ sessionId: "esc" });
    handler.mockClear();
    off();
    mockEmitter.__emit("onTrackingCreated", { sessionId: "post-off" });
    expect(handler).not.toHaveBeenCalled();
  });
});
