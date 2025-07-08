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
  AsleepAnalysisResult,
} from "./Asleep.types";
import AsleepModule from "./AsleepModule";

const emitter = new EventEmitter(AsleepModule);

export interface AsleepState {
  didClose: boolean;
  isTracking: boolean;
  isTrackingPaused: boolean;
  error: string | null;
  userId: string | null;
  sessionId: string | null;
  showDebugLog: boolean;
  log: string;
  analysisResult: AsleepAnalysisResult | null;
  isODAEnabled: boolean;
  isAnalyzing: boolean;
  trackingStartTime: Date | null;
  isInitialized: boolean;
  isSetupInProgress: boolean;
  isSetupComplete: boolean;

  // actions
  setup: (config: AsleepSetupConfig) => Promise<void>;
  initAsleepConfig: (config: AsleepConfig) => Promise<void>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  getReport: (sessionId: string) => Promise<AsleepReport | null>;
  getReportList: (fromDate: string, toDate: string) => Promise<AsleepSession[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  requestMicrophonePermission: () => Promise<boolean>;
  setCustomNotification: (title: string, text: string) => Promise<void>;
  enableLog: (print: boolean) => void;
  requestAnalysis: () => Promise<AsleepAnalysisResult | null>;
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void
  ) => () => void;
  getTrackingDurationMinutes: () => number;

  // internal actions
  setError: (error: string | null) => void;
  setUserId: (userId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setIsTracking: (isTracking: boolean) => void;
  setIsTrackingPaused: (isTrackingPaused: boolean) => void;
  setDidClose: (didClose: boolean) => void;
  setAnalysisResult: (result: AsleepAnalysisResult | null) => void;
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  setTrackingStartTime: (time: Date | null) => void;
  setIsInitialized: (initialized: boolean) => void;
  setIsSetupInProgress: (inProgress: boolean) => void;
  setIsSetupComplete: (complete: boolean) => void;
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
    isTrackingPaused: false,
    error: null,
    userId: null,
    sessionId: null,
    showDebugLog: false,
    log: "",
    analysisResult: null,
    isODAEnabled: false,
    isAnalyzing: false,
    trackingStartTime: null,
    isInitialized: false,
    isSetupInProgress: false,
    isSetupComplete: false,

    // actions
    setup: async (config: AsleepSetupConfig) => {
      try {
        const { addLog, isSetupInProgress, isTracking } = get();

        // Prevent duplicate execution if setup is already in progress
        if (isSetupInProgress) {
          addLog(
            "[setup] Setup is already in progress. Please try again later."
          );
          throw new Error("Setup is already in progress.");
        }

        // Block setup execution if tracking is in progress
        if (isTracking) {
          addLog("[setup] Cannot execute setup while tracking is in progress.");
          throw new Error(
            "Cannot execute setup while tracking is in progress."
          );
        }

        addLog("[setup] Start");
        set({ isSetupInProgress: true, error: null });

        await AsleepModule.setup(
          config.apiKey,
          config.baseUrl,
          config.callbackUrl,
          config.service,
          config.enableODA
        );

        // Store ODA enabled state
        set({
          isODAEnabled: config.enableODA || false,
          isInitialized: true,
          isSetupInProgress: false,
          isSetupComplete: true,
        });
        addLog(`[setup] Success - ODA enabled: ${config.enableODA || false}`);
      } catch (error: any) {
        console.error("setup error:", error);
        set({ error: error.message, isSetupInProgress: false });
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

        set({ isInitialized: true });
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
        const {
          requestMicrophonePermission,
          addLog,
          isODAEnabled,
          isSetupInProgress,
        } = get();

        // Block startTracking execution if setup is in progress
        if (isSetupInProgress) {
          addLog(
            "[startTracking] Cannot start tracking while setup is in progress."
          );
          throw new Error("Cannot start tracking while setup is in progress.");
        }

        // Prevent duplicate execution if already tracking
        if (get().isTracking) {
          addLog("[startTracking] Tracking is already in progress.");
          throw new Error("Tracking is already in progress.");
        }

        addLog("[startTracking] Start");

        const permission = await requestMicrophonePermission();
        if (!permission) {
          Alert.alert("Microphone permission denied");
          throw new Error("Microphone permission denied");
        }

        set({
          didClose: false,
          isTracking: true,
          isAnalyzing: false,
          trackingStartTime: new Date(),
        });
        await AsleepModule.startTracking();

        if (isODAEnabled) {
          addLog(
            "[startTracking] ODA enabled - real-time analysis will start automatically"
          );
        } else {
          addLog("[startTracking] ODA not enabled");
        }

        addLog("[startTracking] Success");
      } catch (error: any) {
        console.error("startTracking error:", error);
        set({
          error: error.message,
          isTracking: false,
          isAnalyzing: false,
          trackingStartTime: null,
        });
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
          isAnalyzing: false,
          trackingStartTime: null,
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
        
        // Ensure the report has the expected AsleepReport structure
        // Handle cases where native modules might return data in different formats
        if (convertedReport && !convertedReport.session && convertedReport.sessionId) {
          // If the data comes in a flat format (like AsleepSession), convert it to AsleepReport format
          const normalizedReport: AsleepReport = {
            timezone: convertedReport.timezone || "",
            session: {
              id: convertedReport.sessionId || convertedReport.id || sessionId,
              createdTimezone: convertedReport.createdTimezone || "",
              startTime: convertedReport.sessionStartTime || convertedReport.startTime || "",
              endTime: convertedReport.sessionEndTime || convertedReport.endTime,
              unexpectedEndTime: convertedReport.unexpectedEndTime,
              state: convertedReport.state || "",
              sleepStages: convertedReport.sleepStages,
              breathStages: convertedReport.breathStages,
              snoringStages: convertedReport.snoringStages,
            },
            missingDataRatio: convertedReport.missingDataRatio || 0,
            peculiarities: convertedReport.peculiarities || [],
            stat: convertedReport.stat,
          };
          return normalizedReport;
        }
        
        return convertedReport as AsleepReport;
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

    deleteSession: async (sessionId: string) => {
      try {
        const { addLog } = get();
        addLog(`[deleteSession] sessionId: ${sessionId}`);

        await AsleepModule.deleteSession(sessionId);

        addLog("[deleteSession] Success");
      } catch (error: any) {
        console.error("deleteSession error:", error);
        set({ error: error.message });
        throw error;
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

    requestAnalysis: async () => {
      try {
        const { addLog } = get();
        addLog("[requestAnalysis] Start");

        set({ isAnalyzing: true });

        const result = await AsleepModule.requestAnalysis();
        const convertedResult = convertKeysToCamelCase(result);

        // Platform differences:
        // Android: Returns the actual analysis result immediately and also sends onAnalysisResult event
        // iOS: Returns acknowledgment data only, actual result comes through onAnalysisResult event
        if (Platform.OS === "android" && convertedResult.sleepStages) {
          // Android returns the actual session data
          set({ analysisResult: convertedResult, isAnalyzing: false });
        }
        // For iOS, isAnalyzing will be set to false when onAnalysisResult event fires
        
        addLog(
          `[requestAnalysis] Request sent - ${JSON.stringify(convertedResult)}`
        );

        return convertedResult;
      } catch (error: any) {
        console.error("requestAnalysis error:", error);
        set({ error: error.message, isAnalyzing: false });
        return null;
      }
    },

    addEventListener: <K extends keyof AsleepEventType>(
      eventType: K,
      listener: (data: AsleepEventType[K]) => void
    ) => {
      const subscription = emitter.addListener(eventType, listener);
      return () => subscription.remove();
    },

    getTrackingDurationMinutes: () => {
      const { trackingStartTime } = get();
      if (!trackingStartTime) return 0;
      return Math.floor(
        (Date.now() - trackingStartTime.getTime()) / (1000 * 60)
      );
    },

    // internal actions
    setError: (error) => set({ error }),
    setUserId: (userId) => set({ userId }),
    setSessionId: (sessionId) => set({ sessionId }),
    setIsTracking: (isTracking) => set({ isTracking }),
    setIsTrackingPaused: (isTrackingPaused) => set({ isTrackingPaused }),
    setDidClose: (didClose) => set({ didClose }),
    setAnalysisResult: (result) => set({ analysisResult: result }),
    setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
    setTrackingStartTime: (time) => set({ trackingStartTime: time }),
    setIsInitialized: (initialized) => set({ isInitialized: initialized }),
    setIsSetupInProgress: (inProgress) =>
      set({ isSetupInProgress: inProgress }),
    setIsSetupComplete: (complete) => set({ isSetupComplete: complete }),

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

// Global flag to prevent multiple listener registrations
let listenersInitialized = false;
let cleanupFunction: (() => void) | null = null;

// initialize event listeners
export const initializeAsleepListeners = () => {
  // If listeners are already initialized, return the existing cleanup function
  if (listenersInitialized && cleanupFunction) {
    return cleanupFunction;
  }

  const store = useAsleepStore.getState();
  const {
    addLog,
    setUserId,
    setSessionId,
    setIsTracking,
    setIsTrackingPaused,
    setError,
    setDidClose,
    setAnalysisResult,
    setIsAnalyzing,
    setIsSetupInProgress,
    setIsSetupComplete,
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

      const state = useAsleepStore.getState();
      if (state.isODAEnabled && state.isTracking) {
        state.setIsAnalyzing(true);
        state.requestAnalysis().catch((error) => {
          addLog(`[onTrackingUploaded] Auto analysis failed: ${error.message}`);
          state.setIsAnalyzing(false);
        });
      }
    },
    onTrackingClosed: (data: { sessionId: string }) => {
      setSessionId(data.sessionId);
      setDidClose(true);
      setIsTracking(false);
      setIsAnalyzing(false);
      addLog(`[onTrackingClosed] sessionId: ${data.sessionId}`);
    },
    onTrackingFailed: (error: any) => {
      const errorString = JSON.stringify(error);
      setError(errorString);
      setIsTracking(false);
      setIsAnalyzing(false);
      store.setTrackingStartTime(null);
      addLog(`[onTrackingFailed] error: ${errorString}`);
    },
    onTrackingInterrupted: () => {
      setIsTrackingPaused(true);
      addLog(`[onTrackingInterrupted]`);
    },
    onTrackingResumed: () => {
      setIsTrackingPaused(false);
      addLog(`[onTrackingResumed]`);
    },
    onMicPermissionDenied: () => {
      addLog(`[onMicPermissionDenied]`);
    },
    onDebugLog: (data: any) => {
      addLog(`[onDebugLog] message: ${data.message}`);
    },
    onSetupDidComplete: () => {
      setIsSetupInProgress(false);
      setIsSetupComplete(true);
      addLog(`[onSetupDidComplete]`);
    },
    onSetupDidFail: (data: any) => {
      const errorString = JSON.stringify(data);
      setError(errorString);
      setIsSetupInProgress(false);
      setIsSetupComplete(false);
      addLog(`[onSetupDidFail] error: ${errorString}`);
    },
    onSetupInProgress: (data: any) => {
      setIsSetupInProgress(true);
      addLog(`[onSetupInProgress] progress: ${data.progress}%`);
    },
    onAnalysisResult: (data: any) => {
      setAnalysisResult(data);
      setIsAnalyzing(false);  // Analysis is complete, so set to false
      addLog(`[onAnalysisResult] ${JSON.stringify(data)}`);
    },
  };

  // register all event listeners
  const subscriptions: (() => void)[] = [];

  Object.entries(handlers).forEach(([eventType, handler]) => {
    const subscription = emitter.addListener(eventType, handler);
    subscriptions.push(() => subscription.remove());
  });

  // Mark listeners as initialized
  listenersInitialized = true;

  // Create cleanup function
  cleanupFunction = () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    listenersInitialized = false;
    cleanupFunction = null;
  };

  // return cleanup function
  return cleanupFunction;
};
