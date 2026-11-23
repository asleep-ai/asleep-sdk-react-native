import { EventEmitter } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";
import type {
  AsleepAnalysisAck,
  AsleepAnalysisRange,
  AsleepAnalysisResult,
  AsleepAverageReport,
  AsleepConfig,
  AsleepCredentials,
  AsleepErrorCategory,
  AsleepEventType,
  AsleepProductInfo,
  AsleepReport,
  AsleepSession,
  AsleepSetupConfig,
  AsleepUserMetadata,
  ReanalyzeOptions,
  SetupStatus,
  StopTrackingOptions,
  TrackingConfig,
  TrackingStatus,
} from "./Asleep.types";
import { AsleepError } from "./Asleep.types";
import AsleepModule from "./AsleepModule";
import { createStore } from "./store/createStore";

const emitter = new EventEmitter(AsleepModule);

// Native sessions are already gone for these errors and no close event follows.
const TERMINAL_TRACKING_ERROR_CODES = new Set<string>(["UPLOAD_TRACKING_TERMINATED"]);

// iOS stops recording but leaves the native session open; stopTracking() closes it.
const RECORDING_DEAD_ERROR_CODES = new Set<string>(["AUDIO_INITIALIZATION_FAILED", "INTERRUPTION_RECOVERY_FAILED"]);

// iOS 3.2.0 needs an explicit foreground resume after this failure.
const RECOVERY_REQUIRED_ERROR_CODES = new Set<string>(["CANNOT_ACTIVATE_IN_BACKGROUND"]);

// The first 13 codes are the Android SDK 3.3.x session-teardown set; keep them
// synchronized with AsleepModule.kt's TERMINAL_TRACKING_ERROR_CODES. The rest are
// start failures after which no native session exists: iOS 3.3.2 create HTTP
// 400/403/429/404 (22400, 11403, 11404) and insufficient storage (11008, both
// platforms). Android reports create failures as 22000. 11010 (alreadyTracking)
// is deliberately absent because the existing session survives it.
const TERMINAL_TRACKING_SDK_CODES = new Set<number>([
  11003, 22000, 22401, 22409, 22422, 22500, 23499, 24000, 24400, 24401, 24403, 24404, 24500, 11008, 11403, 11404, 22400,
]);

// The native session survives these exhausted upload attempts.
const TRANSIENT_TRACKING_SDK_CODES = new Set<number>([23000, 23500]);

export interface InternalAsleepState {
  setupStatus: SetupStatus;
  trackingStatus: TrackingStatus;
  sessionId: string | null;
  userId: string | null;
  // The native user config for the most recent initAsleepConfig() exists.
  // Written by initAsleepConfig() start/failure/Android resolution and by
  // onUserJoined/onUserJoinFailed; iOS resolves before the join completes.
  isUserConfigReady: boolean;
  error: AsleepError | null;
  analysisResult: AsleepAnalysisResult | null;
  isAnalyzing: boolean;
  didClose: boolean;
  isODAEnabled: boolean;
  trackingStartTime: Date | null;
  isInitialized: boolean;
  hasCheckedStatus: boolean;
  hasCheckedBatteryOptimization: boolean;
  showDebugLog: boolean;
  log: string;
}

export interface AsleepActions {
  setup: (config: AsleepSetupConfig) => Promise<void>;
  initAsleepConfig: (config: AsleepConfig) => Promise<void>;
  checkAndRestoreTracking: () => Promise<{ hasActiveSession: boolean }>;
  checkBatteryOptimization: () => Promise<{ exempted: boolean; platform: string; message?: string }>;
  requestBatteryOptimizationExemption: () => Promise<boolean>;
  startTracking: (config?: TrackingConfig) => Promise<void>;
  stopTracking: (options?: StopTrackingOptions) => Promise<void>;
  resumeTracking: () => Promise<void>;
  getReport: (sessionId: string) => Promise<AsleepReport>;
  getReportList: (fromDate: string, toDate: string) => Promise<AsleepSession[]>;
  getAverageReport: (fromDate: string, toDate: string) => Promise<AsleepAverageReport>;
  deleteSession: (sessionId: string) => Promise<void>;
  reanalyze: (sessionId: string, options?: ReanalyzeOptions) => Promise<void>;
  saveUserMetadata: (metadata: AsleepUserMetadata) => Promise<void>;
  fetchUserMetadata: () => Promise<AsleepUserMetadata | null>;
  requestAnalysis: () => Promise<AsleepAnalysisResult | AsleepAnalysisAck>;
  hasRequiredPermissions: () => Promise<boolean>;
  requestRequiredPermissions: () => Promise<boolean>;
  setCustomNotification: (title: string, text: string) => Promise<void>;
  enableLog: (print: boolean) => void;
  clearError: () => void;
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void,
  ) => () => void;
}

export interface AsleepPublicState {
  status: TrackingStatus;
  isTracking: boolean;
  isTrackingPaused: boolean;
  isRecoveryRequired: boolean;
  isSetupInProgress: boolean;
  isSetupComplete: boolean;
  sessionId: string | null;
  userId: string | null;
  error: AsleepError | null;
  analysisResult: AsleepAnalysisResult | null;
  isAnalyzing: boolean;
  didClose: boolean;
  isODAEnabled: boolean;
  log: string;
}

export type AsleepPublicApi = AsleepPublicState & AsleepActions;

const initialTrackingStatus: TrackingStatus =
  typeof AsleepModule.isTracking === "function" && AsleepModule.isTracking() ? "tracking" : "idle";

export const useAsleepStore = createStore<InternalAsleepState>(() => ({
  setupStatus: "idle",
  trackingStatus: initialTrackingStatus,
  sessionId: null,
  userId: null,
  isUserConfigReady: false,
  error: null,
  analysisResult: null,
  isAnalyzing: false,
  didClose: false,
  isODAEnabled: false,
  trackingStartTime: null,
  isInitialized: false,
  hasCheckedStatus: false,
  hasCheckedBatteryOptimization: false,
  showDebugLog: false,
  log: "",
}));

const convertKeysToCamelCase = (value: any): any => {
  if (Array.isArray(value)) return value.map(convertKeysToCamelCase);
  if (value !== null && value.constructor === Object) {
    return Object.keys(value).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      result[camelKey] = convertKeysToCamelCase(value[key]);
      return result;
    }, {} as any);
  }
  return value;
};

// Expo promise rejections carry only a code string and a message, so native
// rejections that know the documented SDK code encode it as "<CODE>:<sdkCode>".
const NATIVE_REJECTION_CODE = /^([A-Z][A-Z0-9_]*):(\d+)$/;

type ErrorOptions = {
  category?: AsleepErrorCategory;
  sdkCode?: number;
  caseName?: string;
};

export const normalizeError = (source: unknown, fallbackCode: string, options: ErrorOptions = {}): AsleepError => {
  if (source instanceof AsleepError && Object.keys(options).length === 0) return source;

  const payload =
    source && typeof source === "object"
      ? (source as {
          code?: unknown;
          message?: unknown;
          error?: unknown;
          detail?: unknown;
          sdkCode?: unknown;
          caseName?: unknown;
        })
      : undefined;
  const encoded = typeof payload?.code === "string" ? NATIVE_REJECTION_CODE.exec(payload.code) : null;
  const code = encoded ? encoded[1] : typeof payload?.code === "string" ? payload.code : fallbackCode;
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.detail === "string"
          ? payload.detail
          : source instanceof Error
            ? source.message
            : String(source ?? "Unknown error");

  return new AsleepError(code, message, {
    cause: source instanceof AsleepError ? (source.cause ?? source) : source,
    category: options.category ?? (source instanceof AsleepError ? source.category : undefined),
    sdkCode:
      options.sdkCode ??
      (typeof payload?.sdkCode === "number"
        ? payload.sdkCode
        : encoded
          ? Number(encoded[2])
          : source instanceof AsleepError
            ? source.sdkCode
            : undefined),
    caseName:
      options.caseName ??
      (typeof payload?.caseName === "string"
        ? payload.caseName
        : source instanceof AsleepError
          ? source.caseName
          : undefined),
  });
};

const logPartial = (message: string, state = useAsleepStore.getState()): Partial<InternalAsleepState> => {
  if (!state.showDebugLog) return {};
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
  const log = `[${time}]${message}`;
  console.log(`[Asleep]${log}`);
  return { log };
};

const addLog = (message: string) => {
  useAsleepStore.setState(logPartial(message));
};

const storeAndThrow = (error: AsleepError, partial: Partial<InternalAsleepState> = {}): never => {
  useAsleepStore.setState({ ...partial, error });
  throw error;
};

const guardedFailure = (
  source: unknown,
  fallbackCode: string,
  errorBefore: AsleepError | null,
  partial: Partial<InternalAsleepState> = {},
): never => {
  const current = useAsleepStore.getState().error;
  if (current !== null && current !== errorBefore) {
    useAsleepStore.setState(partial);
    throw current;
  }
  return storeAndThrow(normalizeError(source, fallbackCode), partial);
};

const clearErrorIfUnchanged = (errorBefore: AsleepError | null) => {
  const current = useAsleepStore.getState().error;
  if (current !== null && current === errorBefore) useAsleepStore.setState({ error: null });
};

type NativeCredentials = { apiKey?: string; appId?: string; appSecret?: string };

// Runtime guard for JS callers and casts that bypass the AsleepCredentials union.
const resolveCredentials = (config: AsleepCredentials): NativeCredentials => {
  const { apiKey, appId, appSecret } = (config ?? {}) as { apiKey?: unknown; appId?: unknown; appSecret?: unknown };
  const hasApiKey = apiKey !== undefined;
  const hasToken = appId !== undefined || appSecret !== undefined;
  if (hasApiKey && hasToken) {
    return storeAndThrow(
      new AsleepError("INVALID_ARGUMENT", "Pass either apiKey or appId/appSecret credentials, not both."),
    );
  }
  if (!hasApiKey && !hasToken) {
    return storeAndThrow(
      new AsleepError("INVALID_ARGUMENT", "Credentials are required: pass apiKey or appId/appSecret."),
    );
  }
  const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  if (hasApiKey) {
    if (!isNonEmpty(apiKey))
      return storeAndThrow(new AsleepError("INVALID_ARGUMENT", "apiKey must be a non-empty string."));
    return { apiKey };
  }
  if (!isNonEmpty(appId) || !isNonEmpty(appSecret)) {
    return storeAndThrow(new AsleepError("INVALID_ARGUMENT", "appId and appSecret must both be non-empty strings."));
  }
  return { appId, appSecret };
};

const PRODUCT_INFO_FIELDS = new Set<string>(["model", "identifierType", "identifierValue"]);
const PRODUCT_INFO_LENGTH_LIMITS = { model: 100, identifierValue: 255 } as const;

// Mirrors the native pre-checks (iOS ProductManager.validate, Android
// ProductRegistrar.validate), which otherwise fail the whole setup with 13400:
// not blank after trimming, and the untrimmed value within the length limit.
// Returns null when no productInfo was supplied.
const resolveProductInfo = (productInfo: unknown): AsleepProductInfo | null => {
  if (productInfo == null) return null;
  if (typeof productInfo !== "object" || Array.isArray(productInfo)) {
    return storeAndThrow(new AsleepError("INVALID_ARGUMENT", "productInfo must be an object."));
  }
  const source = productInfo as Record<string, unknown>;
  const unknownField = Object.keys(source).find((field) => !PRODUCT_INFO_FIELDS.has(field));
  if (unknownField !== undefined) {
    return storeAndThrow(new AsleepError("INVALID_ARGUMENT", `productInfo.${unknownField} is not a known field.`));
  }
  for (const [field, max] of Object.entries(PRODUCT_INFO_LENGTH_LIMITS)) {
    const value = source[field];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
      return storeAndThrow(
        new AsleepError(
          "INVALID_ARGUMENT",
          `productInfo.${field} must be a non-blank string of at most ${max} characters.`,
        ),
      );
    }
  }
  if (source.identifierType !== "serial" && source.identifierType !== "mac_address") {
    return storeAndThrow(
      new AsleepError("INVALID_ARGUMENT", 'productInfo.identifierType must be "serial" or "mac_address".'),
    );
  }
  return {
    model: source.model as string,
    identifierType: source.identifierType,
    identifierValue: source.identifierValue as string,
  };
};

const isValidDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

// Both native SDKs reject start >= end (iOS 11009 via didFail after stop has
// already resolved), and they compare at whole-second precision. Returns epoch
// milliseconds for the bridge, or null when no range was supplied.
const resolveAnalysisRange = (range: AsleepAnalysisRange | undefined): [number, number] | null => {
  if (range == null) return null;
  const { start, end } = range as { start?: unknown; end?: unknown };
  if (!isValidDate(start) || !isValidDate(end)) {
    return storeAndThrow(
      new AsleepError("INVALID_ARGUMENT", "analysisRange.start and analysisRange.end must be valid Date objects."),
    );
  }
  if (Math.floor(start.getTime() / 1000) >= Math.floor(end.getTime() / 1000)) {
    return storeAndThrow(
      new AsleepError("INVALID_ARGUMENT", "analysisRange.start must be at least one second before analysisRange.end."),
    );
  }
  return [start.getTime(), end.getTime()];
};

const USER_METADATA_INTEGER_RANGES = {
  birthYear: [1900, 2100],
  birthMonth: [1, 12],
  birthDay: [1, 31],
} as const;

const USER_METADATA_NUMBER_RANGES = {
  height: [1, 500],
  weight: [1, 1000],
} as const;

const USER_METADATA_GENDERS = new Set<string>(["male", "female", "non_binary", "other", "prefer_not_to_say"]);

// Mirrors the native range checks (iOS UserMetadata.validate(), Android
// UserMetadata init) so invalid input never reaches the bridge. Only known
// fields are forwarded; undefined and null mean "not provided".
const resolveUserMetadata = (metadata: AsleepUserMetadata): AsleepUserMetadata => {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return storeAndThrow(new AsleepError("INVALID_ARGUMENT", "metadata must be an object."));
  }
  const source = metadata as Record<string, unknown>;
  const resolved: Record<string, number | string> = {};
  for (const [field, [min, max]] of Object.entries(USER_METADATA_INTEGER_RANGES)) {
    const value = source[field];
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      return storeAndThrow(
        new AsleepError("INVALID_ARGUMENT", `${field} must be an integer between ${min} and ${max}.`),
      );
    }
    resolved[field] = value;
  }
  for (const [field, [min, max]] of Object.entries(USER_METADATA_NUMBER_RANGES)) {
    const value = source[field];
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      return storeAndThrow(new AsleepError("INVALID_ARGUMENT", `${field} must be a number between ${min} and ${max}.`));
    }
    resolved[field] = value;
  }
  if (source.gender != null) {
    if (typeof source.gender !== "string" || !USER_METADATA_GENDERS.has(source.gender)) {
      return storeAndThrow(
        new AsleepError(
          "INVALID_ARGUMENT",
          'gender must be one of "male", "female", "non_binary", "other", or "prefer_not_to_say".',
        ),
      );
    }
    resolved.gender = source.gender;
  }
  return resolved as AsleepUserMetadata;
};

// The native user config exists only after the most recent initAsleepConfig()
// joined its user. A re-init in progress or a failed re-init invalidates it, so
// these calls never run against a previous user's config.
const requireUserConfig = (action: string) => {
  if (!useAsleepStore.getState().isUserConfigReady) {
    storeAndThrow(
      new AsleepError(
        "MISSING_PREREQUISITE",
        `initAsleepConfig() must complete its user join (onUserJoined) before ${action}().`,
      ),
    );
  }
};

const normalizeReport = (report: any, sessionId: string): AsleepReport => {
  const converted = convertKeysToCamelCase(report);
  if (converted && !converted.session && converted.sessionId) {
    return {
      timezone: converted.timezone || "",
      session: {
        id: converted.sessionId || converted.id || sessionId,
        createdTimezone: converted.createdTimezone || "",
        startTime: converted.sessionStartTime || converted.startTime || "",
        endTime: converted.sessionEndTime || converted.endTime,
        unexpectedEndTime: converted.unexpectedEndTime,
        state: converted.state || "",
        sleepStages: converted.sleepStages,
        breathStages: converted.breathStages,
        snoringStages: converted.snoringStages,
      },
      missingDataRatio: converted.missingDataRatio || 0,
      peculiarities: converted.peculiarities || [],
      stat: converted.stat,
    };
  }
  return converted as AsleepReport;
};

export const asleepActions: AsleepActions = {
  setup: async (config) => {
    const credentials = resolveCredentials(config);
    const productInfo = resolveProductInfo(config.productInfo);
    const state = useAsleepStore.getState();
    if (state.setupStatus === "inProgress") {
      storeAndThrow(new AsleepError("OPERATION_IN_PROGRESS", "Setup is already in progress."));
    }
    if (state.trackingStatus !== "idle") {
      storeAndThrow(new AsleepError("INVALID_STATE", "Cannot execute setup while tracking is in progress."));
    }

    const errorBefore = state.error;
    addLog("[setup] Start");
    useAsleepStore.setState({ setupStatus: "inProgress" });
    try {
      // Credentials travel as one record: Expo's Kotlin AsyncFunction accepts at
      // most eight parameters including the promise.
      await AsleepModule.setup(
        credentials,
        config.baseUrl,
        config.callbackUrl,
        config.service,
        config.enableODA,
        productInfo,
      );
      useAsleepStore.setState({
        setupStatus: "complete",
        isODAEnabled: config.enableODA || false,
        isInitialized: true,
      });
      clearErrorIfUnchanged(errorBefore);
      addLog(`[setup] Success - ODA enabled: ${config.enableODA || false}`);
    } catch (error) {
      return guardedFailure(error, "SETUP_FAILED", errorBefore, { setupStatus: "idle" });
    }
  },

  initAsleepConfig: async (config) => {
    const credentials = resolveCredentials(config);
    const state = useAsleepStore.getState();
    if (state.setupStatus === "inProgress") {
      return storeAndThrow(new AsleepError("OPERATION_IN_PROGRESS", "Setup is already in progress."));
    }
    // No tracking-state guard here: checkAndRestoreTracking() reconnects a live
    // session before the app configures the SDK, so this must remain callable
    // while trackingStatus is "tracking" (v1 behavior the restore flow relies on).
    const errorBefore = state.error;
    addLog("[initAsleepConfig] Start");
    useAsleepStore.setState({ setupStatus: "inProgress", isUserConfigReady: false });
    try {
      const result = await AsleepModule.initAsleepConfig(
        credentials.apiKey,
        credentials.appId,
        credentials.appSecret,
        config.userId,
        config.baseUrl,
        config.callbackUrl,
      );
      // Android resolves after its join with { userId }. iOS resolves before the
      // join, so readiness waits for onUserJoined; never reset it here because
      // that event may already have arrived.
      const joined = typeof result?.userId === "string" && result.userId.length > 0;
      useAsleepStore.setState({
        setupStatus: "complete",
        isInitialized: true,
        ...(joined ? { isUserConfigReady: true } : {}),
      });
      clearErrorIfUnchanged(errorBefore);
      addLog("[initAsleepConfig] Success");
    } catch (error) {
      return guardedFailure(error, "INIT_CONFIG_FAILED", errorBefore, {
        setupStatus: "idle",
        isUserConfigReady: false,
      });
    }
  },

  checkAndRestoreTracking: async () => {
    const errorBefore = useAsleepStore.getState().error;
    addLog("[checkAndRestoreTracking] Start");
    try {
      const isAlive = await AsleepModule.isSleepTrackingAlive();
      let trackingStatus = useAsleepStore.getState().trackingStatus;
      if (isAlive && Platform.OS === "android") {
        const isConnected = await AsleepModule.connectSleepTracking();
        if (isConnected) trackingStatus = "tracking";
      }
      useAsleepStore.setState({ hasCheckedStatus: true, trackingStatus });
      clearErrorIfUnchanged(errorBefore);
      addLog(`[checkAndRestoreTracking] Complete - hasActiveSession: ${isAlive}`);
      return { hasActiveSession: isAlive };
    } catch (error) {
      return guardedFailure(error, "CHECK_AND_RESTORE_FAILED", errorBefore);
    }
  },

  checkBatteryOptimization: async () => {
    const errorBefore = useAsleepStore.getState().error;
    addLog("[checkBatteryOptimization] Checking battery optimization status...");
    useAsleepStore.setState({ hasCheckedBatteryOptimization: true });
    try {
      if (Platform.OS === "ios") {
        clearErrorIfUnchanged(errorBefore);
        return { exempted: true, platform: "ios" };
      }
      const exempted = await AsleepModule.isBatteryOptimizationExempted();
      clearErrorIfUnchanged(errorBefore);
      return {
        exempted,
        platform: "android",
        message: exempted
          ? "Battery optimization disabled - ready for tracking"
          : "Battery optimization must be disabled for reliable tracking",
      };
    } catch (error) {
      return guardedFailure(error, "CHECK_BATTERY_OPTIMIZATION_FAILED", errorBefore);
    }
  },

  requestBatteryOptimizationExemption: async () => {
    const errorBefore = useAsleepStore.getState().error;
    if (Platform.OS === "ios") {
      clearErrorIfUnchanged(errorBefore);
      return true;
    }
    try {
      const result = await AsleepModule.requestBatteryOptimizationExemption();
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "REQUEST_BATTERY_EXEMPTION_FAILED", errorBefore);
    }
  },

  startTracking: async (config) => {
    const state = useAsleepStore.getState();
    if (!state.hasCheckedStatus) {
      storeAndThrow(
        new AsleepError(
          "MISSING_PREREQUISITE",
          "Must call checkAndRestoreTracking() at app startup before starting tracking.",
        ),
      );
    }
    if (!state.hasCheckedBatteryOptimization) {
      storeAndThrow(
        new AsleepError("MISSING_PREREQUISITE", "Must call checkBatteryOptimization() before starting tracking."),
      );
    }
    if (state.setupStatus === "inProgress") {
      storeAndThrow(new AsleepError("INVALID_STATE", "Cannot start tracking while setup is in progress."));
    }
    if (state.trackingStatus !== "idle") {
      storeAndThrow(new AsleepError("OPERATION_IN_PROGRESS", "Tracking is already in progress."));
    }

    const errorBefore = state.error;
    try {
      if (!(await asleepActions.hasRequiredPermissions())) {
        storeAndThrow(
          new AsleepError(
            "PERMISSION_DENIED",
            "Microphone permission is required. Call requestRequiredPermissions() before startTracking().",
          ),
        );
      }

      if (Platform.OS === "android" && !(await AsleepModule.isBatteryOptimizationExempted())) {
        storeAndThrow(
          new AsleepError(
            "BATTERY_NOT_EXEMPTED",
            "Battery optimization must be disabled before startTracking(). Call requestBatteryOptimizationExemption().",
          ),
        );
      }

      useAsleepStore.setState({
        didClose: false,
        trackingStatus: "tracking",
        isAnalyzing: false,
        trackingStartTime: new Date(),
      });
      await AsleepModule.startTracking(config);
      clearErrorIfUnchanged(errorBefore);
      addLog("[startTracking] Success");
    } catch (error) {
      return guardedFailure(error, "START_TRACKING_FAILED", errorBefore, {
        trackingStatus: "idle",
        isAnalyzing: false,
        trackingStartTime: null,
      });
    }
  },

  stopTracking: async (options) => {
    const range = resolveAnalysisRange(options?.analysisRange);
    const errorBefore = useAsleepStore.getState().error;
    try {
      const result = await (range ? AsleepModule.stopTracking(range[0], range[1]) : AsleepModule.stopTracking());
      useAsleepStore.setState({
        didClose: true,
        ...(typeof result === "string" && result ? { sessionId: result } : {}),
        trackingStatus: "idle",
        isAnalyzing: false,
        trackingStartTime: null,
      });
      clearErrorIfUnchanged(errorBefore);
      addLog(`[stopTracking] Success - result: ${result}`);
    } catch (error) {
      return guardedFailure(error, "STOP_TRACKING_FAILED", errorBefore);
    }
  },

  resumeTracking: async () => {
    if (Platform.OS !== "ios") {
      storeAndThrow(new AsleepError("UNSUPPORTED_PLATFORM", "resumeTracking is only supported on iOS."));
    }
    const errorBefore = useAsleepStore.getState().error;
    try {
      await AsleepModule.resumeTracking();
      clearErrorIfUnchanged(errorBefore);
    } catch (error) {
      return guardedFailure(error, "RESUME_TRACKING_FAILED", errorBefore);
    }
  },

  getReport: async (sessionId) => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      const payload = await AsleepModule.getReport(sessionId);
      if (payload == null) {
        throw new AsleepError("REPORT_NOT_FOUND", `No report available for session "${sessionId}".`);
      }
      const report = normalizeReport(payload, sessionId);
      clearErrorIfUnchanged(errorBefore);
      return report;
    } catch (error) {
      return guardedFailure(error, "GET_REPORT_FAILED", errorBefore);
    }
  },

  getReportList: async (fromDate, toDate) => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      const reportList = (await AsleepModule.getReportList(fromDate, toDate)) ?? [];
      const result = reportList.map((session: any) => {
        const converted = convertKeysToCamelCase(session);
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
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "GET_REPORT_LIST_FAILED", errorBefore);
    }
  },

  getAverageReport: async (fromDate, toDate) => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      const payload = await AsleepModule.getAverageReport(fromDate, toDate);
      if (payload == null) {
        throw new AsleepError("REPORT_NOT_FOUND", `No average report available for ${fromDate} to ${toDate}.`);
      }
      const result = convertKeysToCamelCase(payload);
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "GET_AVERAGE_REPORT_FAILED", errorBefore);
    }
  },

  deleteSession: async (sessionId) => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      await AsleepModule.deleteSession(sessionId);
      clearErrorIfUnchanged(errorBefore);
    } catch (error) {
      return guardedFailure(error, "DELETE_SESSION_FAILED", errorBefore);
    }
  },

  reanalyze: async (sessionId, options) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      storeAndThrow(new AsleepError("INVALID_ARGUMENT", "sessionId must be a non-empty string."));
    }
    const range = resolveAnalysisRange(options?.analysisRange);
    requireUserConfig("reanalyze");
    const errorBefore = useAsleepStore.getState().error;
    try {
      // Resolves once the server accepts the request, not when analysis finishes.
      // Nulls are explicit: iOS treats arguments before a Promise as required.
      await AsleepModule.reanalyze(sessionId, range?.[0] ?? null, range?.[1] ?? null);
      clearErrorIfUnchanged(errorBefore);
    } catch (error) {
      return guardedFailure(error, "REANALYZE_FAILED", errorBefore);
    }
  },

  saveUserMetadata: async (metadata) => {
    const resolved = resolveUserMetadata(metadata);
    requireUserConfig("saveUserMetadata");
    const errorBefore = useAsleepStore.getState().error;
    try {
      await AsleepModule.saveUserMetadata(resolved);
      clearErrorIfUnchanged(errorBefore);
    } catch (error) {
      return guardedFailure(error, "SAVE_USER_METADATA_FAILED", errorBefore);
    }
  },

  fetchUserMetadata: async () => {
    requireUserConfig("fetchUserMetadata");
    const errorBefore = useAsleepStore.getState().error;
    try {
      const payload = await AsleepModule.fetchUserMetadata();
      // Android serializes the native model with snake_case keys.
      const result: AsleepUserMetadata | null = payload == null ? null : convertKeysToCamelCase(payload);
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "FETCH_USER_METADATA_FAILED", errorBefore);
    }
  },

  requestAnalysis: async () => {
    const errorBefore = useAsleepStore.getState().error;
    useAsleepStore.setState({ isAnalyzing: true });
    try {
      const result = convertKeysToCamelCase(await AsleepModule.requestAnalysis());
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "REQUEST_ANALYSIS_FAILED", errorBefore, { isAnalyzing: false });
    }
  },

  hasRequiredPermissions: async () => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      const result = await AsleepModule.hasRequiredPermissions();
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "CHECK_PERMISSION_FAILED", errorBefore);
    }
  },

  requestRequiredPermissions: async () => {
    const errorBefore = useAsleepStore.getState().error;
    try {
      if (Platform.OS === "android") {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (Platform.Version >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        const results = await PermissionsAndroid.requestMultiple(permissions);
        // POST_NOTIFICATIONS is requested for foreground-service notification
        // visibility but is not needed for tracking to run, so the returned
        // boolean mirrors hasRequiredPermissions(): microphone-side grants only.
        const audioGranted =
          results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
        clearErrorIfUnchanged(errorBefore);
        return audioGranted;
      }
      const result = await AsleepModule.requestRequiredPermissions();
      clearErrorIfUnchanged(errorBefore);
      return result;
    } catch (error) {
      return guardedFailure(error, "REQUEST_PERMISSION_FAILED", errorBefore);
    }
  },

  setCustomNotification: async (_title, _text) => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn(
        "[Asleep] setCustomNotification is deprecated and a no-op; pass notification options to startTracking() instead.",
      );
    }
  },

  enableLog: (print) => {
    if (Platform.OS === "ios") AsleepModule.enableLog(print);
    useAsleepStore.setState({ showDebugLog: print });
  },

  clearError: () => useAsleepStore.setState({ error: null }),

  addEventListener: (eventType, listener) => {
    const subscription = emitter.addListener(eventType, listener);
    return () => subscription.remove();
  },
};

let lastInternal: InternalAsleepState | null = null;
let lastPublic: AsleepPublicApi | null = null;

export const toPublicState = (internal: InternalAsleepState): AsleepPublicApi => {
  if (internal === lastInternal && lastPublic) return lastPublic;
  // Recovery-required is still a live native session on main; preserve that
  // contract while representing the recovery fact with one enum value.
  const isTracking = internal.trackingStatus !== "idle";
  const next: AsleepPublicApi = {
    status: internal.trackingStatus,
    isTracking,
    isTrackingPaused: internal.trackingStatus === "paused",
    isRecoveryRequired: internal.trackingStatus === "recoveryRequired",
    isSetupInProgress: internal.setupStatus === "inProgress",
    isSetupComplete: internal.setupStatus === "complete",
    sessionId: internal.sessionId,
    userId: internal.userId,
    error: internal.error,
    analysisResult: internal.analysisResult,
    isAnalyzing: internal.isAnalyzing,
    didClose: internal.didClose,
    isODAEnabled: internal.isODAEnabled,
    log: internal.log,
    ...asleepActions,
  };
  lastInternal = internal;
  if (
    lastPublic &&
    lastPublic.status === next.status &&
    lastPublic.sessionId === next.sessionId &&
    lastPublic.userId === next.userId &&
    lastPublic.error === next.error &&
    lastPublic.analysisResult === next.analysisResult &&
    lastPublic.isAnalyzing === next.isAnalyzing &&
    lastPublic.didClose === next.didClose &&
    lastPublic.isODAEnabled === next.isODAEnabled &&
    lastPublic.log === next.log &&
    lastPublic.isSetupInProgress === next.isSetupInProgress &&
    lastPublic.isSetupComplete === next.isSetupComplete
  ) {
    return lastPublic;
  }
  lastPublic = next;
  return lastPublic;
};

type EventName = keyof AsleepEventType;

const transitionForEvent = (
  eventType: EventName,
  payload: any,
  state: InternalAsleepState,
): { partial: Partial<InternalAsleepState>; log: string; requestAnalysis?: boolean } => {
  switch (eventType) {
    case "onUserJoined":
      return {
        partial: { userId: payload.userId, isUserConfigReady: true },
        log: `[onUserJoined] userId: ${payload.userId}`,
      };
    case "onUserJoinFailed":
      return {
        partial: { error: normalizeError(payload, "USER_JOIN_FAILED"), isUserConfigReady: false },
        log: `[onUserJoinFailed] error: ${payload?.message ?? payload?.detail ?? payload?.error ?? "Unknown error"}`,
      };
    case "onUserDeleted":
      return { partial: { userId: null }, log: `[onUserDeleted] userId: ${payload.userId}` };
    case "onTrackingCreated":
      return {
        partial: { trackingStatus: "tracking", ...(payload?.sessionId ? { sessionId: payload.sessionId } : {}) },
        log: `[onTrackingCreated]${payload?.sessionId ? ` sessionId: ${payload.sessionId}` : ""}`,
      };
    case "onTrackingUploaded": {
      const shouldAnalyze =
        state.trackingStatus !== "idle" &&
        (state.isODAEnabled || (payload.sequence >= 10 && payload.sequence % 10 === 1));
      return {
        partial: {
          // iOS 3.2.0 emits didResume before its engine restart is proven.
          // Only a completed upload clears recovery; see AGENTS.md
          // "Native Behavior Compensations".
          ...(state.trackingStatus === "recoveryRequired" ? { trackingStatus: "tracking" as const } : {}),
          ...(shouldAnalyze ? { isAnalyzing: true } : {}),
        },
        log: `[onTrackingUploaded] sequence: ${payload.sequence}`,
        requestAnalysis: shouldAnalyze,
      };
    }
    case "onTrackingClosed":
      return {
        partial: {
          sessionId: payload.sessionId,
          trackingStatus: "idle",
          isAnalyzing: false,
          didClose: true,
          trackingStartTime: null,
        },
        log: `[onTrackingClosed] sessionId: ${payload.sessionId}`,
      };
    case "onTrackingFailed": {
      const recordingDead = !!payload && RECORDING_DEAD_ERROR_CODES.has(payload.code);
      const recoveryRequired = !!payload && RECOVERY_REQUIRED_ERROR_CODES.has(payload.code);
      const terminal =
        !!payload &&
        !recordingDead &&
        !recoveryRequired &&
        (TERMINAL_TRACKING_ERROR_CODES.has(payload.code) || TERMINAL_TRACKING_SDK_CODES.has(payload.sdkCode));
      const transient = !!payload && TRANSIENT_TRACKING_SDK_CODES.has(payload.sdkCode);
      const category: AsleepErrorCategory = recordingDead
        ? "recordingDead"
        : recoveryRequired
          ? "recoveryRequired"
          : terminal
            ? "terminal"
            : transient
              ? "transient"
              : "unknown";
      const error = normalizeError(payload, "TRACKING_FAILED", {
        category,
        sdkCode: typeof payload?.sdkCode === "number" ? payload.sdkCode : undefined,
        caseName: typeof payload?.caseName === "string" ? payload.caseName : undefined,
      });

      if (terminal) {
        return {
          partial: {
            // iOS closeSessionSilently (upload 4xx) does not emit didClose, and
            // start failures never create a session, so this branch must clear
            // the projected session state itself.
            error,
            trackingStatus: "idle",
            isAnalyzing: false,
            didClose: true,
            trackingStartTime: null,
          },
          log: `[onTrackingError] error: ${error.message}`,
        };
      }
      if (recordingDead) {
        return {
          partial: {
            // iOS audioInitializationFailed and interruptionRecoveryFailed stop
            // the recorder but keep the native session open (didClose=false).
            error,
            trackingStatus: "idle",
            isAnalyzing: false,
            didClose: false,
            trackingStartTime: null,
          },
          log: `[onTrackingError] error: ${error.message}`,
        };
      }
      if (recoveryRequired) {
        return {
          // iOS cannotActivateInBackground keeps the session alive. 3.3.x also
          // retries on foreground; only a later upload proves recovery.
          partial: { error, trackingStatus: "recoveryRequired" },
          log: `[onTrackingError] error: ${error.message}`,
        };
      }
      return { partial: { error }, log: `[onTrackingError] error: ${error.message}` };
    }
    case "onTrackingInterrupted":
      return { partial: { trackingStatus: "paused" }, log: "[onTrackingInterrupted]" };
    case "onTrackingResumed":
      return {
        partial: {
          error: null,
          // iOS 3.2.1-3.3.0 can emit didResume twice, and recovery paths can
          // resume without a prior pause. Always clear the error, but mutate
          // the paused state only for the first event.
          ...(state.trackingStatus === "paused" ? { trackingStatus: "tracking" as const } : {}),
        },
        log:
          state.trackingStatus === "paused"
            ? "[onTrackingResumed]"
            : "[onTrackingResumed] (no prior pause; error cleared)",
      };
    case "onMicPermissionDenied":
      return { partial: {}, log: "[onMicPermissionDenied]" };
    case "onDebugLog":
      return { partial: {}, log: `[onDebugLog] message: ${payload.message}` };
    case "onSetupDidComplete":
      return { partial: { setupStatus: "complete" }, log: "[onSetupDidComplete]" };
    case "onSetupDidFail":
      return {
        partial: { error: normalizeError(payload, "SETUP_FAILED"), setupStatus: "idle" },
        log: `[onSetupDidFail] error: ${payload?.message ?? payload?.error ?? "Unknown error"}`,
      };
    case "onSetupInProgress":
      return { partial: { setupStatus: "inProgress" }, log: `[onSetupInProgress] progress: ${payload.progress}%` };
    case "onAnalysisResult": {
      // Android SDK 3.2.x emits snake_case while iOS emits camelCase.
      const analysisResult = convertKeysToCamelCase(payload);
      return {
        partial: { analysisResult, isAnalyzing: false },
        log: `[onAnalysisResult] ${JSON.stringify(analysisResult)}`,
      };
    }
  }
};

const applyEvent = (eventType: EventName, payload: unknown) => {
  const state = useAsleepStore.getState();
  const transition = transitionForEvent(eventType, payload, state);
  useAsleepStore.setState({ ...transition.partial, ...logPartial(transition.log, state) });
  if (transition.requestAnalysis) {
    void asleepActions.requestAnalysis().catch((error) => {
      addLog(`[onTrackingUploaded] Auto analysis failed: ${error.message}`);
    });
  }
};

let refCount = 0;
let teardown: (() => void) | null = null;

export const initializeAsleepListeners = (): (() => void) => {
  if (teardown) {
    refCount++;
    return makeCleanup();
  }

  const eventTypes: EventName[] = [
    "onUserJoined",
    "onUserJoinFailed",
    "onUserDeleted",
    "onTrackingCreated",
    "onTrackingUploaded",
    "onTrackingClosed",
    "onTrackingFailed",
    "onTrackingInterrupted",
    "onTrackingResumed",
    "onMicPermissionDenied",
    "onDebugLog",
    "onSetupDidComplete",
    "onSetupDidFail",
    "onSetupInProgress",
    "onAnalysisResult",
  ];
  const subscriptions = eventTypes.map((eventType) =>
    emitter.addListener(eventType, (payload: unknown) => applyEvent(eventType, payload)),
  );

  refCount++;
  teardown = () => {
    subscriptions.forEach((subscription) => subscription.remove());
    teardown = null;
  };
  return makeCleanup();
};

const makeCleanup = (): (() => void) => {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    refCount--;
    if (refCount === 0 && teardown) teardown();
  };
};
