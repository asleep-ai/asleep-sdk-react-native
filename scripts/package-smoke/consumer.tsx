// Type-checked against the packed tarball installed into a throwaway app, not
// against src/, so it sees exactly what an npm consumer sees: the published
// `types` entry, the `build/` declarations and the documented public surface.
import { useEffect } from "react";
import { Text } from "react-native";
import {
  Asleep,
  AsleepError,
  useAsleep,
  type AsleepErrorCategory,
  type AsleepEventType,
  type AsleepPublicApi,
  type AsleepReport,
  type TrackingStatus,
} from "react-native-asleep";

export function TrackingScreen() {
  const { status, isTracking, error, startTracking, stopTracking, getReport } = useAsleep();

  useEffect(() => {
    const unsubscribe = Asleep.addEventListener("onTrackingFailed", (payload: AsleepEventType["onTrackingFailed"]) => {
      void payload;
    });
    return unsubscribe;
  }, []);

  const onPress = async (): Promise<AsleepReport | null> => {
    if (isTracking) {
      await stopTracking();
      return null;
    }
    await startTracking();
    return getReport("session-id");
  };
  void onPress;

  const label: TrackingStatus = status;
  const category: AsleepErrorCategory | undefined = error?.category;
  return <Text>{`${label} ${category ?? ""} ${error instanceof AsleepError ? error.code : ""}`}</Text>;
}

const dispose: () => void = Asleep.initialize();
const snapshot: AsleepPublicApi = Asleep.getState();
const unsubscribe: () => void = Asleep.subscribe((state) => void state.sessionId);
void [dispose, snapshot, unsubscribe];

const failure = new AsleepError("TRACKING_FAILED", "example", { sdkCode: 11003, caseName: "audio" });
const code: string = failure.code;
void code;
