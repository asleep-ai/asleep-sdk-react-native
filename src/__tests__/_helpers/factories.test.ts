/**
 * Shared test helpers and module mocks.
 *
 * Tests that touch AsleepStore must register the AsleepModule, expo-modules-core,
 * and react-native mocks before importing the store. Use installModuleMocks()
 * as a one-liner; or compose manually with the factories below.
 */

export type MockPlatform = {
  OS: "ios" | "android";
  Version: number;
};

export const setMockPlatform = (platform: MockPlatform) => {
  const rn = require("react-native");
  rn.Platform.OS = platform.OS;
  rn.Platform.Version = platform.Version;
};

export type MockAsleepModule = {
  setup: jest.Mock;
  initAsleepConfig: jest.Mock;
  startTracking: jest.Mock;
  stopTracking: jest.Mock;
  resumeTracking: jest.Mock;
  isTracking: jest.Mock;
  isSleepTrackingAlive: jest.Mock;
  connectSleepTracking: jest.Mock;
  isBatteryOptimizationExempted: jest.Mock;
  requestBatteryOptimizationExemption: jest.Mock;
  getReport: jest.Mock;
  getReportList: jest.Mock;
  getAverageReport: jest.Mock;
  deleteSession: jest.Mock;
  hasRequiredPermissions: jest.Mock;
  requestRequiredPermissions: jest.Mock;
  setCustomNotification: jest.Mock;
  enableLog: jest.Mock;
  requestAnalysis: jest.Mock;
};

export type MockEventEmitter = {
  addListener: jest.Mock;
  removeAllListeners: jest.Mock;
  __emit: (event: string, payload: unknown) => void;
  __listenerCount: (event: string) => number;
};

export const createMockAsleepModule = (): MockAsleepModule => ({
  setup: jest.fn().mockResolvedValue(undefined),
  initAsleepConfig: jest.fn().mockResolvedValue(undefined),
  startTracking: jest.fn().mockResolvedValue(undefined),
  stopTracking: jest.fn().mockResolvedValue("session-stub"),
  resumeTracking: jest.fn().mockResolvedValue(undefined),
  isTracking: jest.fn().mockReturnValue(false),
  isSleepTrackingAlive: jest.fn().mockResolvedValue(false),
  connectSleepTracking: jest.fn().mockResolvedValue(false),
  isBatteryOptimizationExempted: jest.fn().mockResolvedValue(true),
  requestBatteryOptimizationExemption: jest.fn().mockResolvedValue(true),
  getReport: jest.fn().mockResolvedValue(null),
  getReportList: jest.fn().mockResolvedValue([]),
  getAverageReport: jest.fn().mockResolvedValue(null),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  hasRequiredPermissions: jest.fn().mockResolvedValue(true),
  requestRequiredPermissions: jest.fn().mockResolvedValue(true),
  setCustomNotification: jest.fn().mockResolvedValue(undefined),
  enableLog: jest.fn(),
  requestAnalysis: jest.fn().mockResolvedValue({}),
});

export const createMockEventEmitter = (): MockEventEmitter => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const addListener = jest.fn((event: string, listener: (payload: unknown) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return {
      remove: () => listeners.get(event)?.delete(listener),
    };
  });
  const removeAllListeners = jest.fn((event: string) => {
    listeners.delete(event);
  });
  return {
    addListener,
    removeAllListeners,
    __emit: (event: string, payload: unknown) => {
      listeners.get(event)?.forEach((l) => l(payload));
    },
    __listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
};

describe("createMockEventEmitter", () => {
  it("delivers payloads to all registered listeners", () => {
    const emitter = createMockEventEmitter();
    const a = jest.fn();
    const b = jest.fn();
    emitter.addListener("evt", a);
    emitter.addListener("evt", b);
    emitter.__emit("evt", { foo: 1 });
    expect(a).toHaveBeenCalledWith({ foo: 1 });
    expect(b).toHaveBeenCalledWith({ foo: 1 });
  });

  it("supports per-listener removal", () => {
    const emitter = createMockEventEmitter();
    const a = jest.fn();
    const b = jest.fn();
    const subA = emitter.addListener("evt", a);
    emitter.addListener("evt", b);
    subA.remove();
    emitter.__emit("evt", "payload");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("payload");
  });
});

describe("createMockAsleepModule", () => {
  it("provides resolved-promise defaults for every async surface", async () => {
    const mod = createMockAsleepModule();
    await expect(mod.setup()).resolves.toBeUndefined();
    await expect(mod.stopTracking()).resolves.toBe("session-stub");
    expect(mod.isTracking()).toBe(false);
  });
});
