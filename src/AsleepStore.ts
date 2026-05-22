import { EventEmitter } from "expo-modules-core";
import { Platform, PermissionsAndroid } from "react-native";
import {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
  AsleepAverageReport,
  AsleepAnalysisResult,
  TrackingConfig,
} from "./Asleep.types";
import { AsleepError } from "./Asleep.types";
import AsleepModule from "./AsleepModule";
import { createStore } from "./store/createStore";

const emitter = new EventEmitter(AsleepModule);

// Error codes emitted on onTrackingFailed for which the native SDK has already
// terminated the session and will not deliver onTrackingClosed. JS must clear
// tracking state itself when one of these arrives. See AGENTS.md "Native Behavior
// Compensations" for the upstream behavior these guard against.
const TERMINAL_TRACKING_ERROR_CODES = new Set<string>([
  "UPLOAD_TRACKING_TERMINATED", // iOS 403/429 closeSessionSilently; Android errorCode 23499
  "INTERRUPTION_RECOVERY_FAILED", // iOS 3 failed auto-resume attempts (3.2.0+)
]);

/**
 * Wrap an arbitrary throwable or native event payload into AsleepError.
 * Preserves the original via `cause`, falls back to `defaultCode` when the
 * source has no `code` field, and never loses the message even for primitives.
 * If the source is already an AsleepError it is returned untouched.
 */
const normalizeError = (source: unknown, defaultCode: string): AsleepError => {
  if (source instanceof AsleepError) return source;
  if (source && typeof source === "object") {
    const s = source as { code?: unknown; message?: unknown; error?: unknown };
    const code = typeof s.code === "string" ? s.code : defaultCode;
    const message =
      typeof s.message === "string"
        ? s.message
        : typeof s.error === "string"
          ? s.error
          : source instanceof Error
            ? source.message
            : "Unknown error";
    return new AsleepError(code, message, source);
  }
  return new AsleepError(defaultCode, String(source ?? "Unknown error"), source);
};

export interface AsleepState {
  didClose: boolean;
  isTracking: boolean;
  isTrackingPaused: boolean;
  error: AsleepError | null;
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

  // Service status tracking
  hasCheckedStatus: boolean;

  // Battery optimization tracking
  hasCheckedBatteryOptimization: boolean;

  // actions
  setup: (config: AsleepSetupConfig) => Promise<void>;
  initAsleepConfig: (config: AsleepConfig) => Promise<void>;
  checkAndRestoreTracking: () => Promise<{ hasActiveSession: boolean }>;
  checkBatteryOptimization: () => Promise<{ exempted: boolean; platform: string; message?: string }>;
  requestBatteryOptimizationExemption: () => Promise<boolean>;
  startTracking: (config?: TrackingConfig) => Promise<void>;
  stopTracking: () => Promise<void>;
  getReport: (sessionId: string) => Promise<AsleepReport>;
  getReportList: (fromDate: string, toDate: string) => Promise<AsleepSession[]>;
  getAverageReport: (fromDate: string, toDate: string) => Promise<AsleepAverageReport>;
  deleteSession: (sessionId: string) => Promise<void>;
  requestMicrophonePermission: () => Promise<boolean>; // deprecated
  requestRequiredPermissions: () => Promise<boolean>;
  setCustomNotification: (title: string, text: string) => Promise<void>;
  enableLog: (print: boolean) => void;
  clearError: () => void;
  requestAnalysis: () => Promise<AsleepAnalysisResult>;
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void,
  ) => () => void;
  getTrackingDurationMinutes: () => number;

  // internal actions
  setError: (error: AsleepError | null) => void;
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
  setHasCheckedStatus: (checked: boolean) => void;
  setHasCheckedBatteryOptimization: (checked: boolean) => void;
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

export const useAsleepStore = createStore<AsleepState>((set, get) => ({
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

  // Service status state
  hasCheckedStatus: false,

  // Battery optimization state
  hasCheckedBatteryOptimization: false,

  // actions
  setup: async (config: AsleepSetupConfig) => {
    try {
      const { addLog, isSetupInProgress, isTracking } = get();

      // Prevent duplicate execution if setup is already in progress
      if (isSetupInProgress) {
        addLog("[setup] Setup is already in progress. Please try again later.");
        throw new AsleepError("OPERATION_IN_PROGRESS", "Setup is already in progress.");
      }

      // Block setup execution if tracking is in progress
      if (isTracking) {
        addLog("[setup] Cannot execute setup while tracking is in progress.");
        throw new AsleepError("INVALID_STATE", "Cannot execute setup while tracking is in progress.");
      }

      addLog("[setup] Start");
      set({ isSetupInProgress: true, error: null });

      await AsleepModule.setup(config.apiKey, config.baseUrl, config.callbackUrl, config.service, config.enableODA);

      // Store ODA enabled state. Clearing `error` on success keeps the
      // reactive `useAsleep().error` field aligned with the actual SDK status
      // (no stale failure messages after a successful retry).
      set({
        isODAEnabled: config.enableODA || false,
        isInitialized: true,
        isSetupInProgress: false,
        isSetupComplete: true,
        error: null,
      });
      addLog(`[setup] Success - ODA enabled: ${config.enableODA || false}`);
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "SETUP_FAILED");
      set({ error: asleepError, isSetupInProgress: false });
      throw asleepError;
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
        config.callbackUrl,
      );

      set({ isInitialized: true, error: null });
      addLog("[initAsleepConfig] Success");
      return result;
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "INIT_CONFIG_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  checkAndRestoreTracking: async () => {
    try {
      const { addLog } = get();
      addLog("[checkAndRestoreTracking] Start");

      // Check if sleep tracking service is alive
      const isAlive = await AsleepModule.isSleepTrackingAlive();

      set({
        hasCheckedStatus: true,
      });

      // If service is alive on Android, restore connection to it
      if (isAlive && Platform.OS === "android") {
        addLog("[checkAndRestoreTracking] Service is alive, restoring connection...");
        const isConnected = await AsleepModule.connectSleepTracking();

        if (isConnected) {
          set({ isTracking: true });
          addLog("[checkAndRestoreTracking] Successfully restored connection to existing service");
        } else {
          addLog("[checkAndRestoreTracking] Failed to restore connection to existing service");
        }
      }

      addLog(`[checkAndRestoreTracking] Complete - hasActiveSession: ${isAlive}`);
      return {
        hasActiveSession: isAlive,
      };
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "CHECK_AND_RESTORE_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  /**
   * Checks battery optimization status on the device.
   * REQUIRED: Must be called before startTracking() on both iOS and Android.
   *
   * This ensures cross-platform consistency - iOS developers must handle
   * battery optimization to prevent their Android users from experiencing issues.
   *
   * @returns Promise with exemption status and platform information
   * @returns {boolean} exempted - Whether battery optimization is disabled (always true on iOS)
   * @returns {string} platform - Current platform ('ios' or 'android')
   * @returns {string} message - Optional status message
   */
  checkBatteryOptimization: async () => {
    const { addLog } = get();

    addLog("[checkBatteryOptimization] Checking battery optimization status...");

    // Mark that check was performed (required for startTracking)
    set({ hasCheckedBatteryOptimization: true });

    if (Platform.OS === "ios") {
      addLog("[checkBatteryOptimization] iOS - not applicable");
      return { exempted: true, platform: "ios" };
    }

    // Android: Check current status
    const exempted = await AsleepModule.isBatteryOptimizationExempted();
    addLog(`[checkBatteryOptimization] Exempted: ${exempted}`);

    return {
      exempted,
      platform: "android",
      message: exempted
        ? "Battery optimization disabled - ready for tracking"
        : "Battery optimization must be disabled for reliable tracking",
    };
  },

  /**
   * Requests battery optimization exemption from the user.
   * On Android: Opens system settings for battery optimization.
   * On iOS: No-op, returns true (not applicable).
   *
   * Use this when checkBatteryOptimization() returns exempted: false.
   *
   * @returns Promise<boolean> - true if already exempted or iOS, false if settings opened
   */
  requestBatteryOptimizationExemption: async () => {
    const { addLog } = get();

    if (Platform.OS === "ios") {
      addLog("[requestBatteryOptimizationExemption] iOS - not applicable");
      return true; // Not applicable on iOS
    }

    addLog("[requestBatteryOptimizationExemption] Opening battery settings...");

    // This just opens settings, doesn't wait
    // Returns true if already exempted, false if settings opened
    return await AsleepModule.requestBatteryOptimizationExemption();
  },

  /**
   * Starts sleep tracking session.
   *
   * Prerequisites:
   * 1. checkAndRestoreTracking() must be called at app startup
   * 2. checkBatteryOptimization() must be called (required on both platforms)
   *
   * @param config Optional tracking configuration
   * @throws Error if prerequisites are not met or tracking is already in progress
   */
  startTracking: async (config?: TrackingConfig) => {
    try {
      const { requestRequiredPermissions, addLog, isODAEnabled, isSetupInProgress, hasCheckedStatus } = get();

      // Enforce that checkAndRestoreTracking must be called first
      if (!hasCheckedStatus) {
        addLog("[startTracking] Must call checkAndRestoreTracking() at app startup");
        throw new AsleepError(
          "MISSING_PREREQUISITE",
          "Must call checkAndRestoreTracking() at app startup before starting tracking",
        );
      }

      // Enforce battery optimization check on BOTH platforms for consistency
      // This ensures iOS developers handle battery optimization for their Android users
      if (!get().hasCheckedBatteryOptimization) {
        addLog("[startTracking] ERROR: Must check battery optimization first");
        throw new AsleepError(
          "MISSING_PREREQUISITE",
          "Must call checkBatteryOptimization() before starting tracking. " +
            "This check is required on both iOS and Android to ensure cross-platform consistency.",
        );
      }

      // Block startTracking execution if setup is in progress
      if (isSetupInProgress) {
        addLog("[startTracking] Cannot start tracking while setup is in progress.");
        throw new AsleepError("INVALID_STATE", "Cannot start tracking while setup is in progress.");
      }

      // Prevent duplicate execution if already tracking
      if (get().isTracking) {
        addLog("[startTracking] Tracking is already in progress.");
        throw new AsleepError("OPERATION_IN_PROGRESS", "Tracking is already in progress.");
      }

      addLog("[startTracking] Start");

      const permission = await requestRequiredPermissions();
      if (!permission) {
        // SDK shouldn't show UI directly - throw a typed error and let the consumer render UX.
        const message =
          Platform.OS === "android" && Platform.Version >= 33
            ? "Microphone and notification permissions are required for sleep tracking"
            : "Microphone permission is required for sleep tracking";
        throw new AsleepError("PERMISSION_DENIED", message);
      }

      // Always verify CURRENT exemption status
      if (Platform.OS === "android") {
        const batteryExempted = await AsleepModule.isBatteryOptimizationExempted();
        if (!batteryExempted) {
          addLog("[startTracking] ERROR: Battery optimization not disabled");
          throw new AsleepError(
            "BATTERY_NOT_EXEMPTED",
            "Battery optimization must be disabled for reliable sleep tracking. " +
              "Call requestBatteryOptimizationExemption() to guide user to settings.",
          );
        }
        addLog("[startTracking] Battery optimization exempted - OK");
      }

      set({
        didClose: false,
        isTracking: true,
        isAnalyzing: false,
        trackingStartTime: new Date(),
        error: null,
      });
      await AsleepModule.startTracking(config);

      if (isODAEnabled) {
        addLog("[startTracking] ODA enabled - real-time analysis will start automatically");
      } else {
        addLog("[startTracking] ODA not enabled");
      }

      addLog("[startTracking] Success");
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "START_TRACKING_FAILED");
      set({
        error: asleepError,
        isTracking: false,
        isAnalyzing: false,
        trackingStartTime: null,
      });
      throw asleepError;
    }
  },

  stopTracking: async () => {
    try {
      const { addLog } = get();
      addLog("[stopTracking] Start");

      const result = await AsleepModule.stopTracking();
      set({
        didClose: true,
        ...(result ? { sessionId: result } : {}),
        isTracking: false,
        isAnalyzing: false,
        trackingStartTime: null,
        error: null,
      });

      addLog(`[stopTracking] Success - result: ${result}`);
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "STOP_TRACKING_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  getReport: async (sessionId: string) => {
    // Snapshot the error before the await so we only clear it on success if
    // no concurrent failure (e.g. onTrackingFailed firing during the network
    // round-trip) replaced it with a different value in the meantime.
    const errorBefore = get().error;
    try {
      const { addLog } = get();
      addLog(`[getReport] sessionId: ${sessionId}`);

      const report = await AsleepModule.getReport(sessionId);
      const convertedReport = convertKeysToCamelCase(report);

      addLog("[getReport] Success");
      if (get().error !== null && get().error === errorBefore) set({ error: null });

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
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "GET_REPORT_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  getReportList: async (fromDate: string, toDate: string) => {
    const errorBefore = get().error;
    try {
      const { addLog } = get();
      addLog(`[getReportList] fromDate: ${fromDate}, toDate: ${toDate}`);

      const reportList = await AsleepModule.getReportList(fromDate, toDate);
      const convertedList = reportList.map((session: any) => {
        const converted = convertKeysToCamelCase(session);
        // Normalize property names to match other session types
        return {
          id: converted.sessionId || converted.id,
          state: converted.state,
          startTime: converted.sessionStartTime || converted.startTime,
          endTime: converted.sessionEndTime || converted.endTime,
          createdTimezone: converted.createdTimezone,
          unexpectedEndTime: converted.unexpectedEndTime,
          lastReceivedSeqNum: converted.lastReceivedSeqNum,
          timeInBed: converted.timeInBed,
        };
      });

      addLog("[getReportList] Success");
      if (get().error !== null && get().error === errorBefore) set({ error: null });
      return convertedList;
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "GET_REPORT_LIST_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  deleteSession: async (sessionId: string) => {
    const errorBefore = get().error;
    try {
      const { addLog } = get();
      addLog(`[deleteSession] sessionId: ${sessionId}`);

      await AsleepModule.deleteSession(sessionId);

      addLog("[deleteSession] Success");
      if (get().error !== null && get().error === errorBefore) set({ error: null });
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "DELETE_SESSION_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  getAverageReport: async (fromDate: string, toDate: string) => {
    const errorBefore = get().error;
    try {
      const { addLog } = get();
      addLog(`[getAverageReport] fromDate: ${fromDate}, toDate: ${toDate}`);

      const averageReport = await AsleepModule.getAverageReport(fromDate, toDate);
      const convertedReport = convertKeysToCamelCase(averageReport);

      addLog("[getAverageReport] Success");
      if (get().error !== null && get().error === errorBefore) set({ error: null });
      return convertedReport;
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "GET_AVERAGE_REPORT_FAILED");
      set({ error: asleepError });
      throw asleepError;
    }
  },

  /**
   * @deprecated Use requestRequiredPermissions instead. This method will be removed in a future version.
   */
  requestMicrophonePermission: async () => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn(
        "[Asleep] requestMicrophonePermission is deprecated. Please use requestRequiredPermissions instead.",
      );
    }
    return get().requestRequiredPermissions();
  },

  requestRequiredPermissions: async () => {
    if (Platform.OS === "android") {
      try {
        // Prepare permissions array with RECORD_AUDIO
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];

        // Add POST_NOTIFICATIONS for Android 13+ (API level 33)
        if (Platform.Version >= 33) {
          permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }

        // Request all permissions together for better UX (single dialog)
        const results = await PermissionsAndroid.requestMultiple(permissions);

        // Check if all required permissions are granted
        const audioGranted =
          results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;

        const notificationGranted =
          Platform.Version >= 33
            ? results[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] === PermissionsAndroid.RESULTS.GRANTED
            : true;

        // Both must be granted for tracking to work properly
        return audioGranted && notificationGranted;
      } catch (err) {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Asleep] Permission request error:", err);
        return false;
      }
    }
    // iOS uses native implementation
    return AsleepModule.requestRequiredPermissions();
  },

  setCustomNotification: async (title: string, text: string) => {
    if (Platform.OS === "android") {
      await AsleepModule.setCustomNotification(title, text);
    } else {
      if (typeof __DEV__ !== "undefined" && __DEV__)
        console.warn("[Asleep] setCustomNotification is not supported on this platform");
    }
  },

  enableLog: (print: boolean) => {
    set({ showDebugLog: print });
  },

  requestAnalysis: async () => {
    try {
      const { addLog } = get();
      addLog("[requestAnalysis] Start");

      set({ isAnalyzing: true, error: null });

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

      addLog(`[requestAnalysis] Request sent - ${JSON.stringify(convertedResult)}`);

      return convertedResult;
    } catch (error: unknown) {
      const asleepError = normalizeError(error, "REQUEST_ANALYSIS_FAILED");
      set({ error: asleepError, isAnalyzing: false });
      throw asleepError;
    }
  },

  addEventListener: <K extends keyof AsleepEventType>(eventType: K, listener: (data: AsleepEventType[K]) => void) => {
    const subscription = emitter.addListener(eventType, listener);
    return () => subscription.remove();
  },

  getTrackingDurationMinutes: () => {
    const { trackingStartTime } = get();
    if (!trackingStartTime) return 0;
    return Math.floor((Date.now() - trackingStartTime.getTime()) / (1000 * 60));
  },

  // internal actions
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setUserId: (userId) => set({ userId }),
  setSessionId: (sessionId) => set({ sessionId }),
  setIsTracking: (isTracking) => set({ isTracking }),
  setIsTrackingPaused: (isTrackingPaused) => set({ isTrackingPaused }),
  setDidClose: (didClose) => set({ didClose }),
  setAnalysisResult: (result) => set({ analysisResult: result }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setTrackingStartTime: (time) => set({ trackingStartTime: time }),
  setIsInitialized: (initialized) => set({ isInitialized: initialized }),
  setIsSetupInProgress: (inProgress) => set({ isSetupInProgress: inProgress }),
  setIsSetupComplete: (complete) => set({ isSetupComplete: complete }),
  setHasCheckedStatus: (checked) => set({ hasCheckedStatus: checked }),
  setHasCheckedBatteryOptimization: (checked) => set({ hasCheckedBatteryOptimization: checked }),

  addLog: (log: string) => {
    // No-op when debug logging is disabled (the default). This is the noise
    // source for useAsleep subscribers: every native event handler calls
    // addLog, so writing to state unconditionally meant each event produced
    // an extra subscriber notification on top of any data update. Now the
    // cost is zero unless the consumer explicitly opts in via enableLog(true).
    const { showDebugLog } = get();
    if (!showDebugLog) return;
    const now = new Date();
    const dateString = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    const formattedLog = `[${dateString}]${log}`;
    console.log(`[Asleep]${formattedLog}`);
    set({ log: formattedLog });
  },
}));

// Ref-counted registration. Each caller (useAsleep effect, Asleep.initialize,
// background context, etc.) increments on entry and decrements via the returned
// cleanup. Native listeners only attach on 0→1 and detach on the final 1→0,
// so concurrent consumers cannot tear each other's subscriptions down.
let refCount = 0;
let teardown: (() => void) | null = null;

export const initializeAsleepListeners = (): (() => void) => {
  // `teardown` is the single source of truth for "listeners are attached".
  // refCount is just a balance counter; always incrementing (rather than
  // assigning =1 on the cold path) keeps the count correct even if a future
  // change introduces an async seam between this check and registration.
  if (teardown) {
    refCount++;
    return makeCleanup();
  }

  const store = useAsleepStore.getState();
  const { addLog, setUserId, setIsTrackingPaused, setError, setIsSetupInProgress } = store;

  // event handlers
  const handlers = {
    // Connected: iOS userDidJoin, Android onSuccess (AsleepConfigListener)
    onUserJoined: (data: any) => {
      setUserId(data.userId);
      addLog(`[onUserJoined] userId: ${data.userId}`);
    },
    // Connected: iOS didFailUserJoin, Android onFail (AsleepConfigListener)
    onUserJoinFailed: (payload: any) => {
      const asleepError = normalizeError(payload, "USER_JOIN_FAILED");
      setError(asleepError);
      addLog(`[onUserJoinFailed] code: ${asleepError.code} message: ${asleepError.message}`);
    },
    // Connected: iOS userDidDelete, Android NOT IMPLEMENTED
    onUserDeleted: (data: any) => {
      setUserId(null);
      addLog(`[onUserDeleted] userId: ${data.userId}`);
    },
    // Connected: iOS didCreate, Android onStart (AsleepTrackingListener)
    onTrackingCreated: (data: any) => {
      // Single setState so subscribers see one notification instead of two.
      useAsleepStore.setState(data?.sessionId ? { isTracking: true, sessionId: data.sessionId } : { isTracking: true });
      addLog(`[onTrackingCreated]${data?.sessionId ? ` sessionId: ${data.sessionId}` : ""}`);
    },
    // Connected: iOS didUpload, Android onPerform (AsleepTrackingListener)
    // Triggers automatic analysis requests in both ODA and non-ODA modes
    onTrackingUploaded: (data: any) => {
      addLog(`[onTrackingUploaded] sequence: ${data.sequence}`);

      const state = useAsleepStore.getState();
      if (state.isODAEnabled && state.isTracking) {
        state.setIsAnalyzing(true);
        state.requestAnalysis().catch((error) => {
          addLog(`[onTrackingUploaded] Auto analysis failed: ${error.message}`);
          state.setIsAnalyzing(false);
        });
      } else if (!state.isODAEnabled && state.isTracking) {
        if (data.sequence >= 10 && data.sequence % 10 === 1) {
          state.setIsAnalyzing(true);
          state.requestAnalysis().catch((error) => {
            addLog(`[onTrackingUploaded] Auto analysis failed: ${error.message}`);
            state.setIsAnalyzing(false);
          });
        }
      }
    },
    // Connected: iOS didClose, Android onFinish (AsleepTrackingListener)
    onTrackingClosed: (data: { sessionId: string }) => {
      // Single setState so subscribers see one notification covering both the
      // sessionId capture and the tracking-state teardown.
      useAsleepStore.setState({
        sessionId: data.sessionId,
        isTracking: false,
        isAnalyzing: false,
        didClose: true,
        trackingStartTime: null,
      });
      addLog(`[onTrackingClosed] sessionId: ${data.sessionId}`);
    },
    // Connected: iOS didFail, Android onFail (AsleepTrackingListener)
    onTrackingFailed: (payload: any) => {
      const asleepError = normalizeError(payload, "TRACKING_FAILED");
      const terminal = TERMINAL_TRACKING_ERROR_CODES.has(asleepError.code);
      useAsleepStore.setState(
        terminal
          ? { error: asleepError, isTracking: false, isAnalyzing: false, didClose: true, trackingStartTime: null }
          : { error: asleepError },
      );
      addLog(`[onTrackingError] code: ${asleepError.code} message: ${asleepError.message}`);
    },
    // Connected: iOS didInterrupt, Android NOT IMPLEMENTED
    onTrackingInterrupted: () => {
      setIsTrackingPaused(true);
      addLog(`[onTrackingInterrupted]`);
    },
    // Connected: iOS didResume, Android NOT IMPLEMENTED
    // Always clear the error: some iOS recovery paths (e.g. cannotActivateInBackground
    // retry) reach this handler without a preceding didInterrupt, and the stale error
    // should still be cleared. Only the paused-state mutation is gated, to dedup the
    // iOS 3.2.1+ double fire from handleRecovering -> handleResumed.
    onTrackingResumed: () => {
      const wasPaused = useAsleepStore.getState().isTrackingPaused;
      useAsleepStore.setState(wasPaused ? { error: null, isTrackingPaused: false } : { error: null });
      addLog(wasPaused ? `[onTrackingResumed]` : `[onTrackingResumed] (no prior pause; error cleared)`);
    },
    // Connected: iOS micPermissionWasDenied, Android NOT IMPLEMENTED
    onMicPermissionDenied: () => {
      addLog(`[onMicPermissionDenied]`);
    },
    // Connected: iOS didPrint (AsleepDebugLoggerDelegate), Android sendEvent called directly
    onDebugLog: (data: any) => {
      addLog(`[onDebugLog] message: ${data.message}`);
    },
    // Connected: iOS setupDidComplete, Android onComplete (AsleepSetupListener)
    onSetupDidComplete: () => {
      useAsleepStore.setState({ isSetupInProgress: false, isSetupComplete: true });
      addLog(`[onSetupDidComplete]`);
    },
    // Connected: iOS setupDidFail, Android onFail (AsleepSetupListener)
    onSetupDidFail: (payload: any) => {
      const asleepError = normalizeError(payload, "SETUP_FAILED");
      useAsleepStore.setState({ error: asleepError, isSetupInProgress: false, isSetupComplete: false });
      addLog(`[onSetupDidFail] code: ${asleepError.code} message: ${asleepError.message}`);
    },
    // Connected: iOS setupInProgress, Android onProgress (AsleepSetupListener)
    onSetupInProgress: (data: any) => {
      setIsSetupInProgress(true);
      addLog(`[onSetupInProgress] progress: ${data.progress}%`);
    },
    // Connected: iOS analyzing (session), Android onSleepDataReceived (AsleepSleepDataListener)
    onAnalysisResult: (data: any) => {
      useAsleepStore.setState({ analysisResult: data, isAnalyzing: false });
      addLog(`[onAnalysisResult] ${JSON.stringify(data)}`);
    },
  };

  // register all event listeners
  const subscriptions: (() => void)[] = [];

  Object.entries(handlers).forEach(([eventType, handler]) => {
    const subscription = emitter.addListener(eventType, handler);
    subscriptions.push(() => subscription.remove());
  });

  refCount++;
  teardown = () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    teardown = null;
  };

  return makeCleanup();
};

let cleanupCalled: WeakSet<() => void>;
const makeCleanup = (): (() => void) => {
  // Per-caller cleanup that is idempotent (calling twice is a no-op) and
  // only decrements the ref count once.
  cleanupCalled ??= new WeakSet();
  const cleanup = () => {
    if (cleanupCalled.has(cleanup)) return;
    cleanupCalled.add(cleanup);
    refCount--;
    if (refCount === 0 && teardown) {
      teardown();
    }
  };
  return cleanup;
};
