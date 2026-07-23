import { AsleepError } from "../Asleep.types";

describe("AsleepError", () => {
  it("extends Error with a stable code and prototype identity", () => {
    const error = new AsleepError("INVALID_STATE", "Tracking is already active.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AsleepError);
    expect(error.name).toBe("AsleepError");
    expect(error.code).toBe("INVALID_STATE");
    expect(error.message).toBe("Tracking is already active.");
  });

  it("preserves classification metadata and the original cause", () => {
    const cause = {
      code: "TRACKING_FAILED",
      sdkCode: 11003,
      caseName: "audioInitializationFailed",
    };
    const error = new AsleepError("TRACKING_FAILED", "Audio initialization failed.", {
      cause,
      category: "recordingDead",
      sdkCode: 11003,
      caseName: "audioInitializationFailed",
    });

    expect(error.category).toBe("recordingDead");
    expect(error.sdkCode).toBe(11003);
    expect(error.caseName).toBe("audioInitializationFailed");
    expect(error.cause).toBe(cause);
  });

  it("leaves optional metadata undefined when it is not supplied", () => {
    const error = new AsleepError("UNKNOWN_ERROR", "Unknown error");

    expect(error.category).toBeUndefined();
    expect(error.sdkCode).toBeUndefined();
    expect(error.caseName).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("is throwable and retains its identity in a catch clause", () => {
    expect(() => {
      throw new AsleepError("BOOM", "fell over");
    }).toThrow("fell over");

    try {
      throw new AsleepError("BOOM", "fell over");
    } catch (error) {
      expect(error).toBeInstanceOf(AsleepError);
      if (error instanceof AsleepError) {
        expect(error.code).toBe("BOOM");
      }
    }
  });

  it("supports subclassing under transpilation-compatible prototype repair", () => {
    class SpecializedAsleepError extends AsleepError {}

    const error = new SpecializedAsleepError("SPECIAL", "specialized");

    expect(error).toBeInstanceOf(SpecializedAsleepError);
    expect(error).toBeInstanceOf(AsleepError);
  });
});
