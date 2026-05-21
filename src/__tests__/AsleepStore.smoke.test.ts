/**
 * Smoke test: verify mock infrastructure lets us import AsleepStore in Node.
 * Real behavior tests live in AsleepStore.test.ts.
 */
import { createMockAsleepModule, createMockEventEmitter } from "./_helpers/factories.test";

const mockModule = createMockAsleepModule();
const mockEmitter = createMockEventEmitter();

jest.mock("../AsleepModule", () => ({
  __esModule: true,
  default: mockModule,
}));

jest.mock("expo-modules-core", () => ({
  EventEmitter: jest.fn().mockImplementation(() => mockEmitter),
  requireNativeModule: jest.fn(() => mockModule),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "RECORD_AUDIO", POST_NOTIFICATIONS: "POST_NOTIFICATIONS" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    requestMultiple: jest.fn().mockResolvedValue({ RECORD_AUDIO: "granted", POST_NOTIFICATIONS: "granted" }),
  },
}));

describe("AsleepStore mock harness", () => {
  it("imports the store module without throwing", () => {
    const store = require("../AsleepStore");
    expect(store.useAsleepStore).toBeDefined();
    expect(store.initializeAsleepListeners).toBeDefined();
  });

  it("initial state matches expected defaults", () => {
    const { useAsleepStore } = require("../AsleepStore");
    const state = useAsleepStore.getState();
    expect(state.isTracking).toBe(false);
    expect(state.error).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.hasCheckedStatus).toBe(false);
    expect(state.hasCheckedBatteryOptimization).toBe(false);
  });
});
