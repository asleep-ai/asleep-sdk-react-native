import { TrackingConfig, AudioSessionOption, AsleepErrorInfo, AsleepEventType } from "../Asleep.types";

describe("TrackingConfig", () => {
  it("accepts android-only config", () => {
    const config: TrackingConfig = {
      android: {
        notification: {
          title: "Sleep Tracking",
          text: "Monitoring your sleep",
          icon: "ic_notification",
        },
      },
    };
    expect(config.android!.notification!.title).toBe("Sleep Tracking");
    expect(config.ios).toBeUndefined();
  });

  it("accepts ios audioSessionOptions", () => {
    const config: TrackingConfig = {
      ios: {
        audioSessionOptions: ["duckOthers"],
      },
    };
    expect(config.ios!.audioSessionOptions).toEqual(["duckOthers"]);
  });

  it("accepts combined android and ios config", () => {
    const config: TrackingConfig = {
      android: {
        notification: { title: "Tracking" },
      },
      ios: {
        audioSessionOptions: ["duckOthers", "allowAirPlay"],
      },
    };
    expect(config.android!.notification!.title).toBe("Tracking");
    expect(config.ios!.audioSessionOptions).toHaveLength(2);
  });

  it("accepts empty ios audioSessionOptions", () => {
    const config: TrackingConfig = {
      ios: {
        audioSessionOptions: [],
      },
    };
    expect(config.ios!.audioSessionOptions).toEqual([]);
  });

  it("accepts all valid AudioSessionOption values", () => {
    const allOptions: AudioSessionOption[] = ["duckOthers", "allowAirPlay", "allowBluetooth"];
    const config: TrackingConfig = {
      ios: { audioSessionOptions: allOptions },
    };
    expect(config.ios!.audioSessionOptions).toHaveLength(3);
  });
});

describe("onTrackingFailed event payload", () => {
  it("handles uploadTrackingTerminated error", () => {
    const payload: AsleepEventType["onTrackingFailed"] = {
      error: "Upload tracking terminated",
      code: "UPLOAD_TRACKING_TERMINATED",
      message: "Upload failed with HTTP 403: Session already closed",
      errorCode: 23499,
    };
    expect(payload.code).toBe("UPLOAD_TRACKING_TERMINATED");
    expect(payload.errorCode).toBe(23499);
    expect(payload.message).toContain("403");
  });

  it("handles unknown error with caseName", () => {
    const payload: AsleepEventType["onTrackingFailed"] = {
      error: "Something went wrong",
      code: "UNKNOWN_ERROR",
      caseName: "someUnknownCase",
    };
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.caseName).toBe("someUnknownCase");
    expect(payload.message).toBeUndefined();
    expect(payload.errorCode).toBeUndefined();
  });

  it("handles ODA error codes", () => {
    const payload: AsleepEventType["onTrackingFailed"] = {
      error: "ODA integrity check failed",
      code: "ODA_INTEGRITY_FAIL",
      message: "The model has been updated or the file is corrupted",
    };
    expect(payload.code).toBe("ODA_INTEGRITY_FAIL");
  });

  it("serializes correctly via JSON.stringify (matches store handler)", () => {
    const payload: AsleepEventType["onTrackingFailed"] = {
      error: "Upload tracking terminated",
      code: "UPLOAD_TRACKING_TERMINATED",
      message: "Session closed",
      errorCode: 23499,
    };
    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);
    expect(parsed.code).toBe("UPLOAD_TRACKING_TERMINATED");
    expect(parsed.errorCode).toBe(23499);
  });

  it("carries the documented native code as sdkCode alongside the legacy errorCode", () => {
    // Android sends the same value in both fields; iOS sends the NSError
    // bridging ordinal in errorCode and the documented code in sdkCode.
    const payload: AsleepEventType["onTrackingFailed"] = {
      error: "Recording could not resume in background",
      code: "CANNOT_ACTIVATE_IN_BACKGROUND",
      errorCode: 39,
      sdkCode: 11003,
    };
    expect(payload.sdkCode).toBe(11003);
    expect(payload.errorCode).toBe(39);
  });
});

describe("AsleepErrorInfo", () => {
  it("pairs a category with the code and optional native fields", () => {
    const info: AsleepErrorInfo = {
      code: "TRACKING_FAILED",
      category: "transient",
      sdkCode: 23000,
      message: "Failed to upload",
    };
    expect(info.category).toBe("transient");
    expect(info.sdkCode).toBe(23000);
  });

  it("supports the minimal unknown shape", () => {
    const info: AsleepErrorInfo = {
      code: "UNKNOWN_ERROR",
      category: "unknown",
      caseName: "httpStatus(500, ...)",
    };
    expect(info.category).toBe("unknown");
    expect(info.sdkCode).toBeUndefined();
  });
});

describe("event type parity", () => {
  it("onUserJoined includes userId", () => {
    const payload: AsleepEventType["onUserJoined"] = { userId: "user-123" };
    expect(payload.userId).toBe("user-123");
  });

  it("onUserJoinFailed includes error details", () => {
    const payload: AsleepEventType["onUserJoinFailed"] = {
      error: "Invalid API key",
      errorCode: 401,
    };
    expect(payload.error).toBe("Invalid API key");
    expect(payload.errorCode).toBe(401);
  });

  it("onUserDeleted includes userId", () => {
    const payload: AsleepEventType["onUserDeleted"] = { userId: "user-456" };
    expect(payload.userId).toBe("user-456");
  });
});
