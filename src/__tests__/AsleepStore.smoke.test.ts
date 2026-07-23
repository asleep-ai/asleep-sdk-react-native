import { createMockAsleepModule, createMockEventEmitter } from "./_helpers/factories.test";

const mockModule = createMockAsleepModule();
const mockEmitter = createMockEventEmitter();

jest.mock("../AsleepModule", () => ({ __esModule: true, default: mockModule }));
jest.mock("expo-modules-core", () => ({
  EventEmitter: jest.fn().mockImplementation(() => mockEmitter),
  requireNativeModule: jest.fn(() => mockModule),
}));
jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "RECORD_AUDIO", POST_NOTIFICATIONS: "POST_NOTIFICATIONS" },
    RESULTS: { GRANTED: "granted" },
    requestMultiple: jest.fn().mockResolvedValue({ RECORD_AUDIO: "granted" }),
  },
}));

describe("AsleepStore mock harness", () => {
  it("imports the facts store and stable actions", () => {
    const store = require("../AsleepStore");
    expect(store.useAsleepStore).toBeDefined();
    expect(store.asleepActions).toBeDefined();
    expect(store.initializeAsleepListeners).toBeDefined();
  });

  it("projects the expected public defaults", () => {
    const { toPublicState, useAsleepStore } = require("../AsleepStore");
    expect(toPublicState(useAsleepStore.getState())).toMatchObject({
      status: "idle",
      isTracking: false,
      error: null,
      userId: null,
      sessionId: null,
    });
  });
});
