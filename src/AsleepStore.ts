import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { EventEmitter } from "expo-modules-core";
import { Alert, Platform } from "react-native";
import {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
} from "./Asleep.types";
import AsleepModule from "./AsleepModule";

const emitter = new EventEmitter(AsleepModule);

export interface AsleepState {
  didClose: boolean;
  isTracking: boolean;
  error: string | null;
  userId: string | null;
  sessionId: string | null;
  showDebugLog: boolean;
  log: string;

  // actions
  setup: (config: AsleepSetupConfig) => Promise<void>;
  initAsleepConfig: (config: AsleepConfig) => Promise<void>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  getReport: (sessionId: string) => Promise<AsleepReport | null>;
  getReportList: (fromDate: string, toDate: string) => Promise<AsleepSession[]>;
  requestMicrophonePermission: () => Promise<boolean>;
  setCustomNotification: (title: string, text: string) => Promise<void>;
  enableLog: (print: boolean) => void;
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void
  ) => () => void;

  // internal actions
  setError: (error: string | null) => void;
  setUserId: (userId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setIsTracking: (isTracking: boolean) => void;
  setDidClose: (didClose: boolean) => void;
  addLog: (log: string) => void;
}

const convertKeysToCamelCase = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(convertKeysToCamelCase);
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      acc[camelKey] = convertKeysToCamelCase(obj[key]);
      return acc;
    }, {} as any);
  }
  return obj;
};

export const useAsleepStore = create<AsleepState>()(
  subscribeWithSelector((set, get) => ({
    // initial state
    didClose: false,
    isTracking: AsleepModule.isTracking ? AsleepModule.isTracking() : false,
    error: null,
    userId: null,
    sessionId: null,
    showDebugLog: false,
    log: "",

    // actions
    setup: async (config: AsleepSetupConfig) => {
      try {
        const { addLog } = get();
        addLog("[setup] Start");

        await AsleepModule.setup(
          config.apiKey,
          config.baseUrl,
          config.callbackUrl,
          config.service,
          config.enableODA
        );

        addLog("[setup] Success");
      } catch (error: any) {
        console.error("setup error:", error);
        set({ error: error.message });
        throw error;
      }
    },

    initAsleepConfig: async (config: AsleepConfig) => {
      try {
        const { addLog } = get();
        addLog("[initAsleepConfig] Start");

        const result = await AsleepModule.initAsleepConfig(
          config.apiKey,
          config.userId,
          config.baseUrl,
          config.callbackUrl
        );

        addLog("[initAsleepConfig] Success");
        return result;
      } catch (error: any) {
        console.error("initAsleepConfig error:", error);
        set({ error: error.message });
        throw error;
      }
    },

    startTracking: async () => {
      try {
        const { requestMicrophonePermission, addLog } = get();
        addLog("[startTracking] Start");

        const permission = await requestMicrophonePermission();
        if (!permission) {
          Alert.alert("Microphone permission denied");
          throw new Error("Microphone permission denied");
        }

        set({ didClose: false, isTracking: true });
        await AsleepModule.startTracking();

        addLog("[startTracking] Success");
      } catch (error: any) {
        console.error("startTracking error:", error);
        set({ error: error.message, isTracking: false });
        throw error;
      }
    },

    stopTracking: async () => {
      try {
        const { addLog } = get();
        addLog("[stopTracking] Start");

        const sessionId = await AsleepModule.stopTracking();
        set({
          didClose: true,
          sessionId,
          isTracking: false,
        });

        addLog(`[stopTracking] Success - sessionId: ${sessionId}`);
      } catch (error: any) {
        console.error("stopTracking error:", error);
        set({ error: error.message });
        throw error;
      }
    },

    getReport: async (sessionId: string) => {
      try {
        const { addLog } = get();
        addLog(`[getReport] sessionId: ${sessionId}`);

        const report = await AsleepModule.getReport(sessionId);
        const convertedReport = convertKeysToCamelCase(report);

        addLog("[getReport] Success");
        return convertedReport;
      } catch (error: any) {
        console.error("getReport error:", error);
        set({ error: error.message });
        return null;
      }
    },

    getReportList: async (fromDate: string, toDate: string) => {
      try {
        const { addLog } = get();
        addLog(`[getReportList] fromDate: ${fromDate}, toDate: ${toDate}`);

        const reportList = await AsleepModule.getReportList(fromDate, toDate);
        const convertedList = reportList.map(convertKeysToCamelCase);

        addLog("[getReportList] Success");
        return convertedList;
      } catch (error: any) {
        console.error("getReportList error:", error);
        set({ error: error.message });
        return [];
      }
    },

    requestMicrophonePermission: async () => {
      return AsleepModule.requestMicrophonePermission();
    },

    setCustomNotification: async (title: string, text: string) => {
      if (Platform.OS === "android") {
        await AsleepModule.setCustomNotification(title, text);
      } else {
        console.warn("setCustomNotification is not supported on this platform");
      }
    },

    enableLog: (print: boolean) => {
      set({ showDebugLog: print });
    },

    addEventListener: <K extends keyof AsleepEventType>(
      eventType: K,
      listener: (data: AsleepEventType[K]) => void
    ) => {
      const subscription = emitter.addListener(eventType, listener);
      return () => subscription.remove();
    },

    // internal actions
    setError: (error) => set({ error }),
    setUserId: (userId) => set({ userId }),
    setSessionId: (sessionId) => set({ sessionId }),
    setIsTracking: (isTracking) => set({ isTracking }),
    setDidClose: (didClose) => set({ didClose }),

    addLog: (log: string) => {
      const { showDebugLog } = get();
      const now = new Date();
      const dateString = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      const formattedLog = `[${dateString}]${log}`;

      if (showDebugLog) {
        console.log(`[Asleep]${formattedLog}`);
      }

      set({ log: formattedLog });
    },
  }))
);

// initialize event listeners
export const initializeAsleepListeners = () => {
  const store = useAsleepStore.getState();
  const {
    addLog,
    setUserId,
    setSessionId,
    setIsTracking,
    setError,
    setDidClose,
  } = store;

  // event handlers
  const handlers = {
    onUserJoined: (data: any) => {
      setUserId(data.userId);
      addLog(`[onUserJoined] userId: ${data.userId}`);
    },
    onUserJoinFailed: (error: any) => {
      const errorString = JSON.stringify(error);
      setError(errorString);
      addLog(`[onUserJoinFailed] error: ${errorString}`);
    },
    onUserDeleted: (data: any) => {
      setUserId(null);
      addLog(`[onUserDeleted] userId: ${data.userId}`);
    },
    onTrackingCreated: (data: any) => {
      setIsTracking(true);
      if (data && data.sessionId) {
        setSessionId(data.sessionId);
      }
      addLog(
        `[onTrackingCreated]${
          data?.sessionId ? ` sessionId: ${data.sessionId}` : ""
        }`
      );
    },
    onTrackingUploaded: (data: any) => {
      addLog(`[onTrackingUploaded] sequence: ${data.sequence}`);
    },
    onTrackingClosed: (data: { sessionId: string }) => {
      setSessionId(data.sessionId);
      setDidClose(true);
      setIsTracking(false);
      addLog(`[onTrackingClosed] sessionId: ${data.sessionId}`);
    },
    onTrackingFailed: (error: any) => {
      const errorString = JSON.stringify(error);
      setError(errorString);
      setIsTracking(false);
      addLog(`[onTrackingFailed] error: ${errorString}`);
    },
    onTrackingInterrupted: () => {
      setIsTracking(false);
      addLog(`[onTrackingInterrupted]`);
    },
    onTrackingResumed: () => {
      setIsTracking(true);
      addLog(`[onTrackingResumed]`);
    },
    onMicPermissionDenied: () => {
      addLog(`[onMicPermissionDenied]`);
    },
    onDebugLog: (data: any) => {
      addLog(`[onDebugLog] message: ${data.message}`);
    },
    onSetupDidComplete: () => {
      addLog(`[onSetupDidComplete]`);
    },
    onSetupDidFail: (data: any) => {
      const errorString = JSON.stringify(data);
      setError(errorString);
      addLog(`[onSetupDidFail] error: ${errorString}`);
    },
    onSetupInProgress: (data: any) => {
      addLog(`[onSetupInProgress] progress: ${data.progress}%`);
    },
  };

  // register all event listeners
  const subscriptions: (() => void)[] = [];

  Object.entries(handlers).forEach(([eventType, handler]) => {
    const subscription = emitter.addListener(eventType, handler);
    subscriptions.push(() => subscription.remove());
  });

  // return cleanup function
  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
  };
};
