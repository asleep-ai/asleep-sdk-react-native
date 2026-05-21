import { useEffect } from "react";
import type { AsleepEventType } from "./Asleep.types";
import type { AsleepState } from "./AsleepStore";
import { useAsleepStore, initializeAsleepListeners } from "./AsleepStore";

// Keys on AsleepState that exist purely for the event-listener layer in
// AsleepStore.ts to write back into the store. They are NOT part of the
// documented public API and would let consumers corrupt SDK state, so we
// strip them from the escape hatch's getState() return type.
type AsleepInternalKeys =
  | "showDebugLog"
  | "trackingStartTime"
  | "setError"
  | "setUserId"
  | "setSessionId"
  | "setIsTracking"
  | "setIsTrackingPaused"
  | "setDidClose"
  | "setAnalysisResult"
  | "setIsAnalyzing"
  | "setTrackingStartTime"
  | "setIsInitialized"
  | "setIsSetupInProgress"
  | "setIsSetupComplete"
  | "setHasCheckedStatus"
  | "setHasCheckedBatteryOptimization"
  | "addLog";

export type AsleepPublicState = Omit<AsleepState, AsleepInternalKeys>;

export const useAsleep = () => {
  const {
    didClose,
    isTracking,
    error,
    userId,
    sessionId,
    log,
    setup,
    initAsleepConfig,
    checkAndRestoreTracking,
    checkBatteryOptimization,
    requestBatteryOptimizationExemption,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    getAverageReport,
    deleteSession,
    enableLog,
    setCustomNotification,
    requestMicrophonePermission,
    requestRequiredPermissions,
    requestAnalysis,
    isODAEnabled,
    analysisResult,
    isAnalyzing,
    isTrackingPaused,
    getTrackingDurationMinutes,
    isInitialized,
    isSetupInProgress,
    isSetupComplete,
    hasCheckedStatus,
    hasCheckedBatteryOptimization,
    clearError,
    addEventListener,
  } = useAsleepStore();

  useEffect(() => {
    const cleanup = initializeAsleepListeners();
    return cleanup;
  }, []);

  return {
    didClose,
    isTracking,
    error,
    userId,
    sessionId,
    log,
    enableLog,
    setCustomNotification,
    setup,
    initAsleepConfig,
    checkAndRestoreTracking,
    checkBatteryOptimization,
    requestBatteryOptimizationExemption,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    getAverageReport,
    deleteSession,
    requestMicrophonePermission,
    requestRequiredPermissions,
    requestAnalysis,
    isODAEnabled,
    analysisResult,
    isAnalyzing,
    isTrackingPaused,
    getTrackingDurationMinutes,
    isInitialized,
    isSetupInProgress,
    isSetupComplete,
    hasCheckedStatus,
    hasCheckedBatteryOptimization,
    clearError,
    addEventListener,
  };
};

/**
 * Imperative escape hatch for non-React contexts (background callbacks, push
 * handlers, etc.). Prefer the `useAsleep` hook inside React components.
 *
 * Intentionally minimal: state container internals are NOT exposed.
 *
 * **If no React component mounts `useAsleep` at the same time**, you MUST call
 * `Asleep.initialize()` once before subscribing so the native event bridge
 * starts flowing into the store. The returned function detaches listeners when
 * your context shuts down. `initialize()` is ref-counted, so it is safe to call
 * even if `useAsleep` is also mounted.
 */
export const Asleep = {
  initialize: initializeAsleepListeners,
  getState: useAsleepStore.getState as () => AsleepPublicState,
  subscribe: useAsleepStore.subscribe,
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void,
  ): (() => void) => {
    return useAsleepStore.getState().addEventListener(eventType, listener);
  },
};

export type {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepEventType,
  AsleepError,
  AsleepReport,
  AsleepSession,
  AsleepAverageReport,
  AsleepSleptSession,
  AsleepNeverSleptSession,
  AsleepStat,
  AsleepAnalysisResult,
  TrackingConfig,
} from "./Asleep.types";
