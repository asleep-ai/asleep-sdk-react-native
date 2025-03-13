import { EventEmitter } from "expo-modules-core";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import {
  AsleepConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
} from "./Asleep.types";
import AsleepModule from "./AsleepModule";

const emitter = new EventEmitter(AsleepModule);

class Asleep {
  private listeners: {
    [K in keyof AsleepEventType]?: ((data: AsleepEventType[K]) => void)[];
  } = {};

  initAsleepConfig = async (config: AsleepConfig): Promise<void> => {
    try {
      const result = await AsleepModule.initAsleepConfig(
        config.apiKey,
        config.userId,
        config.baseUrl,
        config.callbackUrl
      );
      return result;
    } catch (error) {
      console.error("initAsleepConfig error:", error);
      throw error;
    }
  };

  startTracking = async (): Promise<void> => {
    const permission = await this.requestMicrophonePermission();
    if (!permission) {
      Alert.alert("Microphone permission denied");
      throw new Error("Microphone permission denied");
    }

    return AsleepModule.startTracking();
  };

  stopTracking = async (): Promise<string> => {
    return AsleepModule.stopTracking();
  };

  isTracking = (): boolean => {
    return AsleepModule.isTracking();
  };

  getReport = async (sessionId: string): Promise<AsleepReport> => {
    const report = await AsleepModule.getReport(sessionId);
    return this.convertKeysToCamelCase(report);
  };

  getReportList = async (
    fromDate: string,
    toDate: string
  ): Promise<AsleepSession[]> => {
    const reportList = await AsleepModule.getReportList(fromDate, toDate);
    return reportList.map(this.convertKeysToCamelCase);
  };

  requestMicrophonePermission = async (): Promise<boolean> => {
    return AsleepModule.requestMicrophonePermission();
  };

  setCustomNotification = async (
    title: string,
    text: string
  ): Promise<void> => {
    if (Platform.OS === "android") {
      return AsleepModule.setCustomNotification(title, text);
    } else {
      console.warn("setCustomNotification is not supported on this platform");
    }
  };

  private convertKeysToCamelCase = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(this.convertKeysToCamelCase);
    } else if (obj !== null && obj.constructor === Object) {
      return Object.keys(obj).reduce((acc, key) => {
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        acc[camelKey] = this.convertKeysToCamelCase(obj[key]);
        return acc;
      }, {} as any);
    }
    return obj;
  };

  addEventListener<K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void
  ) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType]!.push(listener);

    const subscription = emitter.addListener(eventType, listener);

    return subscription;
  }

  removeAllListeners = <K extends keyof AsleepEventType>(eventType: K) => {
    if (this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    emitter.removeAllListeners(eventType as string);
  };
}

export const useAsleep = () => {
  const [didClose, setDidClose] = useState(false);
  const [isTracking, setIsTracking] = useState(asleep.isTracking());

  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [log, setLog] = useState<string>("");

  const initAsleepConfig = useCallback(async (config: AsleepConfig) => {
    try {
      console.log("[useAsleep] initAsleepConfig");
      await asleep.initAsleepConfig(config);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const startTracking = useCallback(async () => {
    try {
      console.log("[useAsleep] startTracking");
      setDidClose(false);
      setIsTracking(true);
      console.log("[useAsleep] startTracking isTracking: ", isTracking);
      await asleep.startTracking();
    } catch (err: any) {
      console.error("startTracking error:", err);
      setError(err.message);
    }
  }, []);

  const stopTracking = useCallback(async () => {
    try {
      console.log("[useAsleep] stopTracking");
      const sessionId = await asleep.stopTracking();
      setDidClose(true);
      setSessionId(sessionId);
      setIsTracking(false);
    } catch (err: any) {
      console.error("stopTracking error:", err);
      setError(err.message);
    }
  }, []);

  const getReport = async (sessionId: string): Promise<AsleepReport | null> => {
    try {
      console.log("[useAsleep] getReport sessionId: ", sessionId);
      const report = await asleep.getReport(sessionId);
      return report;
    } catch (err: any) {
      console.error("getReport error:", err);
      setError(err.message);
      return null;
    }
  };

  const getReportList = async (
    fromDate: string,
    toDate: string
  ): Promise<AsleepSession[]> => {
    try {
      console.log(
        `[useAsleep] getReportList fromDate: ${fromDate}, toDate: ${toDate}`
      );
      const reportList = await asleep.getReportList(fromDate, toDate);
      return reportList;
    } catch (err: any) {
      console.error("getReportList error:", err);
      setError(err.message);
      return [];
    }
  };

  const addEventListener = useCallback(
    <K extends keyof AsleepEventType>(
      eventType: K,
      listener: (data: AsleepEventType[K]) => void
    ) => {
      const subscription = asleep.addEventListener(eventType, listener);
      return () => subscription.remove();
    },
    []
  );

  const enableLog = (print: boolean = true) => {
    setShowDebugLog(print);
  };

  const setCustomNotification = useCallback(
    async (title: string, text: string) => {
      if (Platform.OS === "android") {
        await AsleepModule.setCustomNotification(title, text);
      } else {
        console.warn("setCustomNotification is not supported on this platform");
      }
    },
    []
  );

  const addLog = useCallback(
    (log: string) => {
      const now = new Date();
      const dateString = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      if (showDebugLog) {
        console.log(`[Asleep][${dateString}]${log}`);
      }
      setLog(`[${dateString}]${log}`);
    },
    [showDebugLog]
  );

  useEffect(() => {
    const onUserJoined = (data: any) => {
      setUserId(data.userId);
      addLog(`[onUserJoined] userId: ${data.userId}`);
    };
    const onUserJoinFailed = (error: any) => {
      const errorString = JSON.stringify(error);
      setError(errorString);
      addLog(`[onUserJoinFailed] error: ${errorString}`);
    };
    const onUserDeleted = (data: any) => {
      setUserId(null);
      addLog(`[onUserDeleted] userId: ${data.userId}`);
    };
    const onTrackingCreated = (data: any) => {
      setIsTracking(true);
      if (data && data.sessionId) {
        setSessionId(data.sessionId);
      }
      addLog(
        `[onTrackingCreated]${data?.sessionId ? ` sessionId: ${data.sessionId}` : ""}`
      );
    };
    const onTrackingUploaded = (data: any) => {
      addLog(`[onTrackingUploaded] sequence: ${data.sequence}`);
    };
    const onTrackingClosed = (data: { sessionId: string }) => {
      setSessionId(data.sessionId);
      setDidClose(true);
      setIsTracking(false);
      addLog(`[onTrackingClosed] sessionId: ${data.sessionId}`);
    };
    const onTrackingFailed = (error: any) => {
      const errorString = JSON.stringify(error);
      setError(errorString);
      setIsTracking(false);
      addLog(`[onTrackingFailed] error: ${errorString}`);
    };
    const onTrackingInterrupted = () => {
      setIsTracking(false);
      addLog(`[onTrackingInterrupted]`);
    };
    const onTrackingResumed = () => {
      setIsTracking(true);
      addLog(`[onTrackingResumed]`);
    };
    const onMicPermissionDenied = () => {
      addLog(`[onMicPermissionDenied]`);
    };
    const onDebugLog = (data: any) => {
      addLog(`[onDebugLog] message: ${data.message}`);
    };

    const userJoinedListener = addEventListener("onUserJoined", onUserJoined);
    const userJoinFailedListener = addEventListener(
      "onUserJoinFailed",
      onUserJoinFailed
    );
    const userDeletedListener = addEventListener(
      "onUserDeleted",
      onUserDeleted
    );
    const trackingCreatedListener = addEventListener(
      "onTrackingCreated",
      onTrackingCreated
    );
    const trackingUploadedListener = addEventListener(
      "onTrackingUploaded",
      onTrackingUploaded
    );
    const trackingClosedListener = addEventListener(
      "onTrackingClosed",
      onTrackingClosed
    );
    const trackingFailedListener = addEventListener(
      "onTrackingFailed",
      onTrackingFailed
    );
    const trackingInterruptedListener = addEventListener(
      "onTrackingInterrupted",
      onTrackingInterrupted
    );
    const trackingResumedListener = addEventListener(
      "onTrackingResumed",
      onTrackingResumed
    );
    const micPermissionDeniedListener = addEventListener(
      "onMicPermissionDenied",
      onMicPermissionDenied
    );
    const debugLogListener = addEventListener("onDebugLog", onDebugLog);

    return () => {
      userJoinedListener();
      userJoinFailedListener();
      userDeletedListener();
      trackingCreatedListener();
      trackingUploadedListener();
      trackingClosedListener();
      trackingFailedListener();
      trackingInterruptedListener();
      trackingResumedListener();
      micPermissionDeniedListener();
      debugLogListener();
    };
  }, []);

  return {
    didClose,
    error,
    userId,
    sessionId,
    log,
    enableLog,
    setCustomNotification,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    isTracking,
  };
};

const asleep = new Asleep();
export default asleep;

export type {
  AsleepConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
  AsleepStat,
} from "./Asleep.types";
