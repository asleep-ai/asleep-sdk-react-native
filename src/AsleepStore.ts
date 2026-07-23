import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { EventEmitter } from "expo-modules-core";
import { Platform, PermissionsAndroid } from "react-native";
import {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepErrorCategory,
  AsleepErrorInfo,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
  AsleepAverageReport,
  AsleepAnalysisResult,
  AsleepAnalysisAck,
  TrackingConfig,
} from "./Asleep.types";
import AsleepModule from "./AsleepModule";

const emitter = new EventEmitter(AsleepModule);

// All dev-only warnings below are gated with an inline
// `typeof __DEV__ !== "undefined" && __DEV__` check rather than a helper
// function. Metro's inline plugin substitutes the bare `__DEV__` identifier
// for the literal at build time, then constant-folds `typeof <literal>` and
// the `&&` so the entire branch is dead-code-eliminated in production
// bundles. Wrapping the check in a function (e.g. `if (isDev())`) defeats
// that DCE because Metro does not constant-fold through call expressions.
// The `typeof` guard also keeps the module importable from plain Node,
// custom bundlers, or unconfigured jest setups without a ReferenceError.

// Error codes emitted on onTrackingFailed for which the native SDK has already
// terminated the session and will not deliver onTrackingClosed. JS must clear
// tracking state itself when one of these arrives. See AGENTS.md "Native Behavior
// Compensations" for the upstream behavior these guard against.
const TERMINAL_TRACKING_ERROR_CODES = new Set<string>([
  "UPLOAD_TRACKING_TERMINATED", // iOS 403/429 closeSessionSilently; Android errorCode 23499
  "INTERRUPTION_RECOVERY_FAILED", // iOS 3 failed auto-resume attempts (3.2.0+)
]);

// iOS SDK 3.2.0 stops the recorder without closing the native session when
// audio engine initialization fails. The session must be stopped and restarted.
const RECORDING_DEAD_ERROR_CODES = new Set<string>(["AUDIO_INITIALIZATION_FAILED"]);

// iOS SDK 3.2.0 reports this when the audio engine cannot restart in the
// background. The consumer must call resumeTracking() after returning foreground.
const RECOVERY_REQUIRED_ERROR_CODES = new Set<string>(["CANNOT_ACTIVATE_IN_BACKGROUND"]);

// Numeric-code twin of TERMINAL_TRACKING_ERROR_CODES, matched against the
// `sdkCode` payload field. Android SDK 3.2.x AsleepCore.onErrorCodeReceived
// tears the session down and dual-fires onFail + onFinish for exactly these
// codes (the native module suppresses the duplicate onFinish), so JS must
// clear tracking state here or isTracking stays stuck true.
// Must stay in sync with the Kotlin TERMINAL_TRACKING_ERROR_CODES companion
// set in android/src/main/java/ai/asleep/reactnative/AsleepModule.kt.
const TERMINAL_TRACKING_SDK_CODES = new Set<number>([
  11003, // ERR_AUDIO
  22000,
  22401,
  22409,
  22422,
  22500, // ERR_CREATE_*
  23499, // ERR_UPLOAD_TRACKING_TERMINATED
  24000,
  24400,
  24401,
  24403,
  24404,
  24500, // ERR_CLOSE_*
]);

// Upload failures the native session survives: absent from the AsleepCore
// terminal set above, so the Android SDK 3.2.x keeps the session open and later
// uploads continue (UploadDataTask retries 5xx internally before reporting).
// Deliberately small — only codes verifiable in upstream sources.
const TRANSIENT_TRACKING_SDK_CODES = new Set<number>([
  23000, // ERR_UPLOAD_FAILED
  23500, // ERR_UPLOAD_SERVER_ERROR
]);

export interface AsleepState {
  didClose: boolean;
  isTracking: boolean;
  isTrackingPaused: boolean;
  isRecoveryRequired: boolean;
  error: string | null;
  // Structured view of the last onTrackingFailed event. Kept in lockstep with
  // `error`: every write or clear of `error` pairs an errorInfo write — a
  // stale category surviving a later unrelated error would misclassify it.
  errorInfo: AsleepErrorInfo | null;
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
  resumeTracking: () => Promise<void>;
  getReport: (sessionId: string) => Promise<AsleepReport | null>;
  getReportList: (fromDate: string, toDate: string) => Promise<AsleepSession[]>;
  getAverageReport: (fromDate: string, toDate: string) => Promise<AsleepAverageReport | null>;
  deleteSession: (sessionId: string) => Promise<void>;
  requestMicrophonePermission: () => Promise<boolean>; // deprecated
  requestRequiredPermissions: () => Promise<boolean>;
  setCustomNotification: (title: string, text: string) => Promise<void>;
  enableLog: (print: boolean) => void;
  clearError: () => void;
  requestAnalysis: () => Promise<AsleepAnalysisResult | AsleepAnalysisAck | null>;
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void,
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

export const useAsleepStore = create<AsleepState>()(
  subscribeWithSelector((set, get) => ({
    // initial state
    didClose: false,
    isTracking: AsleepModule.isTracking ? AsleepModule.isTracking() : false,
    isTrackingPaused: false,
    isRecoveryRequired: false,
    error: null,
    errorInfo: null,
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
          throw new Error("Setup is already in progress.");
        }

        // Block setup execution if tracking is in progress
        if (isTracking) {
          addLog("[setup] Cannot execute setup while tracking is in progress.");
          throw new Error("Cannot execute setup while tracking is in progress.");
        }

        addLog("[setup] Start");
        set({ isSetupInProgress: true, error: null, errorInfo: null });

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
          errorInfo: null,
        });
        addLog(`[setup] Success - ODA enabled: ${config.enableODA || false}`);
      } catch (error: any) {
        set({ error: error.message, errorInfo: null, isSetupInProgress: false });
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
          config.callbackUrl,
        );

        set({ isInitialized: true, error: null, errorInfo: null });
        addLog("[initAsleepConfig] Success");
        return result;
      } catch (error: any) {
        set({ error: error.message, errorInfo: null });
        throw error;
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
      } catch (error: any) {
        set({ error: error.message, errorInfo: null });
        throw error;
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
          throw new Error("Must call checkAndRestoreTracking() at app startup before starting tracking");
        }

        // Enforce battery optimization check on BOTH platforms for consistency
        // This ensures iOS developers handle battery optimization for their Android users
        if (!get().hasCheckedBatteryOptimization) {
          addLog("[startTracking] ERROR: Must check battery optimization first");
          throw new Error(
            "Must call checkBatteryOptimization() before starting tracking. " +
              "This check is required on both iOS and Android to ensure cross-platform consistency.",
          );
        }

        // Block startTracking execution if setup is in progress
        if (isSetupInProgress) {
          addLog("[startTracking] Cannot start tracking while setup is in progress.");
          throw new Error("Cannot start tracking while setup is in progress.");
        }

        // Prevent duplicate execution if already tracking
        if (get().isTracking) {
          addLog("[startTracking] Tracking is already in progress.");
          throw new Error("Tracking is already in progress.");
        }

        addLog("[startTracking] Start");

        const permission = await requestRequiredPermissions();
        if (!permission) {
          // SDK shouldn't show UI directly - throw specific error message
          if (Platform.OS === "android" && Platform.Version >= 33) {
            throw new Error("Microphone and notification permissions are required for sleep tracking");
          } else {
            throw new Error("Microphone permission is required for sleep tracking");
          }
        }

        // Always verify CURRENT exemption status
        if (Platform.OS === "android") {
          const batteryExempted = await AsleepModule.isBatteryOptimizationExempted();
          if (!batteryExempted) {
            addLog("[startTracking] ERROR: Battery optimization not disabled");
            throw new Error(
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
          isRecoveryRequired: false,
          trackingStartTime: new Date(),
          error: null,
          errorInfo: null,
        });
        await AsleepModule.startTracking(config);

        if (isODAEnabled) {
          addLog("[startTracking] ODA enabled - real-time analysis will start automatically");
        } else {
          addLog("[startTracking] ODA not enabled");
        }

        addLog("[startTracking] Success");
      } catch (error: any) {
        set({
          error: error.message,
          errorInfo: null,
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

        const result = await AsleepModule.stopTracking();
        set({
          didClose: true,
          ...(result ? { sessionId: result } : {}),
          isTracking: false,
          isAnalyzing: false,
          isRecoveryRequired: false,
          trackingStartTime: null,
          error: null,
          errorInfo: null,
        });

        addLog(`[stopTracking] Success - result: ${result}`);
      } catch (error: any) {
        set({ error: error.message, errorInfo: null });
        throw error;
      }
    },

    resumeTracking: async () => {
      if (Platform.OS !== "ios") {
        throw Object.assign(new Error("resumeTracking is only supported on iOS."), {
          name: "AsleepPlatformError",
          code: "UNSUPPORTED_PLATFORM",
        });
      }

      await AsleepModule.resumeTracking();
    },

    getReport: async (sessionId: string) => {
      // Snapshot the error before the await so we only clear it on success
      // if no concurrent failure (e.g. onTrackingFailed firing during the
      // network round-trip) wrote a different error in the meantime.
      const errorBefore = get().error;
      try {
        const { addLog } = get();
        addLog(`[getReport] sessionId: ${sessionId}`);

        const report = await AsleepModule.getReport(sessionId);
        const convertedReport = convertKeysToCamelCase(report);

        addLog("[getReport] Success");
        // Guard so a successful query after a clean run does not spam an empty
        // notification, and so we never clobber an unrelated tracking error
        // that arrived during the await.
        if (get().error !== null && get().error === errorBefore) set({ error: null, errorInfo: null });

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
        // Silent return on failure is a public-API quirk preserved for v1.x
        // compat (v2.0 throws). Surface a dev-only warn so the consumer's
        // Metro log still shows the failure when they're debugging without
        // observing `useAsleep().error` directly.
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Asleep] getReport failed:", error);
        set({ error: error.message, errorInfo: null });
        return null;
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
        if (get().error !== null && get().error === errorBefore) set({ error: null, errorInfo: null });
        return convertedList;
      } catch (error: any) {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Asleep] getReportList failed:", error);
        set({ error: error.message, errorInfo: null });
        return [];
      }
    },

    deleteSession: async (sessionId: string) => {
      const errorBefore = get().error;
      try {
        const { addLog } = get();
        addLog(`[deleteSession] sessionId: ${sessionId}`);

        await AsleepModule.deleteSession(sessionId);

        addLog("[deleteSession] Success");
        if (get().error !== null && get().error === errorBefore) set({ error: null, errorInfo: null });
      } catch (error: any) {
        set({ error: error.message, errorInfo: null });
        throw error;
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
        if (get().error !== null && get().error === errorBefore) set({ error: null, errorInfo: null });
        return convertedReport;
      } catch (error: any) {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Asleep] getAverageReport failed:", error);
        set({ error: error.message, errorInfo: null });
        return null;
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

    setCustomNotification: async (_title: string, _text: string) => {
      // Native method removed; notification config now flows through startTracking options.
      if (typeof __DEV__ !== "undefined" && __DEV__)
        console.warn(
          "[Asleep] setCustomNotification is deprecated and a no-op; pass `{ android: { notification: { title, text, icon } } }` to startTracking() instead",
        );
    },

    enableLog: (print: boolean) => {
      if (Platform.OS === "ios") AsleepModule.enableLog(print);
      set({ showDebugLog: print });
    },

    requestAnalysis: async () => {
      try {
        const { addLog, showDebugLog } = get();
        addLog("[requestAnalysis] Start");

        set({ isAnalyzing: true, error: null, errorInfo: null });

        const result = await AsleepModule.requestAnalysis();
        const convertedResult = convertKeysToCamelCase(result);

        // analysisResult and isAnalyzing are owned by the onAnalysisResult event handler on both
        // platforms. Android resolves the promise with the full session AND fires the event;
        // iOS resolves with an ack only. Writing state here would double-update on Android.

        if (showDebugLog) addLog(`[requestAnalysis] Request sent - ${JSON.stringify(convertedResult)}`);

        return convertedResult;
      } catch (error: any) {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Asleep] requestAnalysis failed:", error);
        set({ error: error.message, errorInfo: null, isAnalyzing: false });
        return null;
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
    // setError takes a raw string, so any structured classification is stale;
    // reset errorInfo rather than let a previous event's category linger.
    setError: (error) => set({ error, errorInfo: null }),
    clearError: () => set({ error: null, errorInfo: null }),
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
      // Zero-cost when the consumer has not opted into debug logging. Without
      // this guard, every native event handler would cause a spurious
      // subscriber notification on top of any actual data update.
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
  })),
);

// Ref-counted registration. Each caller (useAsleep effect, background context,
// etc.) increments on entry and decrements via the returned cleanup. Native
// listeners only attach on 0→1 and detach on the final 1→0, so concurrent
// consumers cannot tear each other's subscriptions down.
let refCount = 0;
let teardown: (() => void) | null = null;

export const initializeAsleepListeners = (): (() => void) => {
  // Cold start when no teardown is installed. `teardown` is the single source
  // of truth for "listeners are currently attached"; refCount is just an
  // increment-only counter for cleanup balancing. Always incrementing
  // (instead of assigning =1 on cold start) keeps the count correct even if
  // a future change introduces an async seam between this check and the
  // listener registration below.
  if (teardown) {
    refCount++;
    return makeCleanup();
  }

  const store = useAsleepStore.getState();
  const { addLog, setUserId, setIsTrackingPaused, setIsSetupInProgress } = store;

  // event handlers — each native SDK event corresponds to one logical state
  // transaction. Use a single useAsleepStore.setState per handler so consumers
  // subscribed via useAsleep re-render once per event, not once per field.
  const handlers = {
    // Connected: iOS userDidJoin, Android onSuccess (AsleepConfigListener)
    onUserJoined: (data: any) => {
      setUserId(data.userId);
      addLog(`[onUserJoined] userId: ${data.userId}`);
    },
    // Connected: iOS didFailUserJoin, Android onFail (AsleepConfigListener)
    onUserJoinFailed: (error: any) => {
      const errorString = JSON.stringify(error);
      // Not a tracking-runtime failure; errorInfo stays reserved for
      // onTrackingFailed classification.
      useAsleepStore.setState({ error: errorString, errorInfo: null });
      addLog(`[onUserJoinFailed] error: ${errorString}`);
    },
    // Connected: iOS userDidDelete, Android NOT IMPLEMENTED
    onUserDeleted: (data: any) => {
      setUserId(null);
      addLog(`[onUserDeleted] userId: ${data.userId}`);
    },
    // Connected: iOS didCreate, Android onStart (AsleepTrackingListener)
    onTrackingCreated: (data: any) => {
      useAsleepStore.setState({
        isTracking: true,
        ...(data?.sessionId ? { sessionId: data.sessionId } : {}),
      });
      addLog(`[onTrackingCreated]${data?.sessionId ? ` sessionId: ${data.sessionId}` : ""}`);
    },
    // Connected: iOS didUpload, Android onPerform (AsleepTrackingListener)
    // Triggers automatic analysis requests in both ODA and non-ODA modes
    onTrackingUploaded: (data: any) => {
      addLog(`[onTrackingUploaded] sequence: ${data.sequence}`);

      // requestAnalysis() flips isAnalyzing internally; no separate setter
      // needed before invoking it (avoids a duplicate subscriber notification).
      const state = useAsleepStore.getState();
      // A completed upload is the only positive proof that recording actually came
      // back — didResume fires before the engine restart is even attempted, so it
      // cannot be trusted to clear this.
      if (state.isRecoveryRequired) useAsleepStore.setState({ isRecoveryRequired: false });
      const triggerAnalysis = () =>
        state.requestAnalysis().catch((error) => {
          addLog(`[onTrackingUploaded] Auto analysis failed: ${error.message}`);
          state.setIsAnalyzing(false);
        });

      if (state.isODAEnabled && state.isTracking) {
        triggerAnalysis();
      } else if (!state.isODAEnabled && state.isTracking) {
        if (data.sequence >= 10 && data.sequence % 10 === 1) {
          triggerAnalysis();
        }
      }
    },
    // Connected: iOS didClose, Android onFinish (AsleepTrackingListener)
    onTrackingClosed: (data: { sessionId: string }) => {
      useAsleepStore.setState({
        sessionId: data.sessionId,
        isTracking: false,
        isAnalyzing: false,
        isRecoveryRequired: false,
        didClose: true,
        trackingStartTime: null,
      });
      addLog(`[onTrackingClosed] sessionId: ${data.sessionId}`);
    },
    // Connected: iOS didFail, Android onFail (AsleepTrackingListener)
    // Four state buckets, each writing tracking state in the same setState as the
    // error so subscribers see one event: terminal (native session already gone),
    // recording-dead (recorder torn down but session still open — clearing
    // isTracking is what unblocks a restart), recovery-required (resumeTracking()
    // in foreground can revive it), and everything else (error only).
    // The two dead-session buckets must also clear isRecoveryRequired: iOS retries
    // cannotActivateInBackground and then gives up with interruptionRecoveryFailed,
    // and no upload will ever arrive to clear the flag on that path.
    // The bucket verdict is also published as errorInfo.category (with the
    // else-bucket split into "transient" vs "unknown") so consumers can gate
    // log severity on data instead of re-deriving code lists themselves.
    onTrackingFailed: (error: any) => {
      // The explicit iOS string buckets must win before the numeric terminal
      // fallback: the numeric set encodes Android teardown semantics, and iOS
      // reuses 11003 (.audioInitializationFailed -> .audio) for a failure whose
      // session is still open. The numeric fallback still matters on iOS for
      // start/stop failures that arrive as UNKNOWN_ERROR + 22xxx/24xxx and must
      // clear the optimistically-set isTracking.
      const recordingDead = !!(error && RECORDING_DEAD_ERROR_CODES.has(error.code));
      const recoveryRequired = !!(error && RECOVERY_REQUIRED_ERROR_CODES.has(error.code));
      const terminal = !!(
        error &&
        !recordingDead &&
        !recoveryRequired &&
        (TERMINAL_TRACKING_ERROR_CODES.has(error.code) || TERMINAL_TRACKING_SDK_CODES.has(error.sdkCode))
      );
      const transient = !!(error && TRANSIENT_TRACKING_SDK_CODES.has(error.sdkCode));

      let category: AsleepErrorCategory;
      if (recordingDead) category = "recordingDead";
      else if (recoveryRequired) category = "recoveryRequired";
      else if (terminal) category = "terminal";
      else if (transient) category = "transient";
      else category = "unknown";

      // Category rides along in the stringified error too, so consumers still
      // parsing the legacy string see the same verdict as errorInfo readers.
      const errorString = JSON.stringify(error ? { ...error, category } : error);
      const errorInfo: AsleepErrorInfo | null = error
        ? {
            code: typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
            category,
            ...(typeof error.sdkCode === "number" ? { sdkCode: error.sdkCode } : {}),
            ...(typeof error.message === "string" ? { message: error.message } : {}),
            ...(typeof error.caseName === "string" ? { caseName: error.caseName } : {}),
          }
        : null;

      let nextState: Partial<AsleepState>;
      if (terminal) {
        nextState = {
          error: errorString,
          errorInfo,
          isTracking: false,
          isAnalyzing: false,
          isRecoveryRequired: false,
          didClose: true,
          trackingStartTime: null,
        };
      } else if (recordingDead) {
        nextState = {
          error: errorString,
          errorInfo,
          isTracking: false,
          isAnalyzing: false,
          isRecoveryRequired: false,
          didClose: false,
          trackingStartTime: null,
        };
      } else if (recoveryRequired) {
        nextState = { error: errorString, errorInfo, isTracking: true, isRecoveryRequired: true };
      } else {
        nextState = { error: errorString, errorInfo };
      }

      useAsleepStore.setState(nextState);
      addLog(`[onTrackingError] error: ${errorString}`);
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
    // isRecoveryRequired, not isTrackingPaused, is authoritative when recording is
    // dead because didResume fires before the engine restart is attempted.
    onTrackingResumed: () => {
      const wasPaused = useAsleepStore.getState().isTrackingPaused;
      useAsleepStore.setState(
        wasPaused ? { error: null, errorInfo: null, isTrackingPaused: false } : { error: null, errorInfo: null },
      );
      addLog(wasPaused ? `[onTrackingResumed]` : `[onTrackingResumed] (no prior pause; error cleared)`);
    },
    // Connected: iOS micPermissionWasDenied, Android NOT IMPLEMENTED
    onMicPermissionDenied: () => {
      addLog(`[onMicPermissionDenied]`);
    },
    // Connected: iOS AsleepLogger callbacks, Android sendEvent called directly
    onDebugLog: (data: any) => {
      addLog(`[onDebugLog] message: ${data.message}`);
    },
    // Connected: iOS setupDidComplete, Android onComplete (AsleepSetupListener)
    onSetupDidComplete: () => {
      useAsleepStore.setState({ isSetupInProgress: false, isSetupComplete: true });
      addLog(`[onSetupDidComplete]`);
    },
    // Connected: iOS setupDidFail, Android onFail (AsleepSetupListener)
    onSetupDidFail: (data: any) => {
      const errorString = JSON.stringify(data);
      useAsleepStore.setState({
        error: errorString,
        errorInfo: null,
        isSetupInProgress: false,
        isSetupComplete: false,
      });
      addLog(`[onSetupDidFail] error: ${errorString}`);
    },
    // Connected: iOS setupInProgress, Android onProgress (AsleepSetupListener)
    onSetupInProgress: (data: any) => {
      setIsSetupInProgress(true);
      addLog(`[onSetupInProgress] progress: ${data.progress}%`);
    },
    // Connected: iOS analyzing (session), Android onSleepDataReceived (AsleepSleepDataListener)
    // Android serializes snake_case; normalize so both platforms match AsleepAnalysisResult.
    onAnalysisResult: (data: any) => {
      const normalized = convertKeysToCamelCase(data);
      useAsleepStore.setState({ analysisResult: normalized, isAnalyzing: false });
      if (useAsleepStore.getState().showDebugLog) {
        addLog(`[onAnalysisResult] ${JSON.stringify(normalized)}`);
      }
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

const makeCleanup = (): (() => void) => {
  // Idempotent per-caller cleanup. The `called` flag is closure-private so
  // calling the returned function twice (e.g. Strict Mode double-effect)
  // decrements the shared ref count only once.
  let called = false;
  return () => {
    if (called) return;
    called = true;
    refCount--;
    if (refCount === 0 && teardown) teardown();
  };
};
