import { useCallback, useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAsleep, AsleepSession, AsleepSDK } from "../src";
import { create } from "zustand";

// Zustand store interface
interface TrackingState {
  shouldStopTracking: boolean;
  reportList: AsleepSession[];
  trackingStartTime: number | null;
  astId: string | null;

  // Actions
  setShouldStopTracking: (should: boolean) => void;
  setReportList: (list: AsleepSession[]) => void;
  setTrackingStartTime: (time: number | null) => void;
  setAstId: (id: string | null) => void;
}

// Create Zustand store
const useTrackingStore = create<TrackingState>((set) => ({
  // Initial state
  shouldStopTracking: false,
  reportList: [],
  trackingStartTime: null,
  astId: null,

  // State update functions
  setShouldStopTracking: (should) => set({ shouldStopTracking: should }),
  setReportList: (list) => set({ reportList: list }),
  setTrackingStartTime: (time) => set({ trackingStartTime: time }),
  setAstId: (id) => set({ astId: id }),
}));

export const useTracking = () => {
  const {
    userId: asleepUserId,
    sessionId,
    checkAndRestoreTracking,
    startTracking,
    stopTracking,
    initAsleepConfig,
    setup,
    getReport,
    analysisResult,
    getReportList,
    isTracking,
    error,
    didClose,
    log,
    isInitialized,
    enableLog,
    isODAEnabled,
    isAnalyzing,
    requestAnalysis,
    isTrackingPaused,
    getTrackingDurationMinutes,
    isSetupInProgress,
    isSetupComplete,
  } = useAsleep();

  // Use Zustand store
  const {
    shouldStopTracking,
    reportList,
    trackingStartTime,
    astId,
    setShouldStopTracking,
    setReportList,
    setTrackingStartTime,
    setAstId,
  } = useTrackingStore();

  // Initialize SDK
  useEffect(() => {
    enableLog(true);
    console.log("🐤 isInitialized", isInitialized);
    if (!isInitialized) {
      initSDK();
    }
  }, [isInitialized]);

  // Manage start time when tracking state changes
  useEffect(() => {
    if (isTracking && !trackingStartTime) {
      setTrackingStartTime(Date.now());
    } else if (!isTracking) {
      setTrackingStartTime(null);
    }
  }, [isTracking]);

  // Set astId
  useEffect(() => {
    if (asleepUserId) {
      console.log("asleepUserId (astId):", asleepUserId);
      setAstId(asleepUserId);
    }
  }, [asleepUserId]);

  const startTrackingWrapper = async () => {
    try {
      if (isSetupInProgress) {
        console.log(
          "🐤 Setup is in progress. Please try again after completion."
        );
        Alert.alert(
          "Notice",
          "Setup is in progress. Please try again after completion."
        );
        return;
      }

      if (!isTracking) {
        await startTracking({ "android": { "notification": { "title": "Asleep Tracking", "text": "Look at the useTracking code to change!" } } });
        setTrackingStartTime(Date.now());
        console.log("🐤 Tracking started");
      }
    } catch (error: any) {
      setShouldStopTracking(true);
      stopTracking();
      console.error("startTrackingWrapper error:", error);
      Alert.alert(
        "Error",
        `Failed to start tracking: ${error?.message || String(error)}`
      );
    }
  };

  const stopTrackingWrapper = async () => {
    await stopTracking();
    setTrackingStartTime(null);
    console.log("🐤 Tracking stopped");
  };

  const hasBeen30 = () => {
    if (!trackingStartTime) return false;
    return Date.now() - trackingStartTime >= 30 * 60 * 1000;
  };

  const tryStopTracking = () => {
    console.log("tryStopTracking, hasBeen30()", hasBeen30());
    if (hasBeen30()) {
      stopTrackingWrapper();
      return true;
    } else {
      Alert.alert(
        "Stop Tracking",
        "Less than 30 minutes. Are you sure you want to stop?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Stop", onPress: stopTrackingWrapper },
        ]
      );
      return false;
    }
  };

  const initSDK = async (preferredAstId?: string) => {
    try {
      const _astId = preferredAstId || astId;
      console.log("initSDK astId:", _astId);

      if (isSetupInProgress) {
        console.log("🐤 Setup is already in progress.");
        return;
      }

      await checkAndRestoreTracking();

      // Check battery optimization for Android
      const batteryStatus = await AsleepSDK.checkBatteryOptimization();
      if (!batteryStatus.exempted && Platform.OS === 'android') {
        console.log("🔋 Battery optimization not exempted, requesting...");
        Alert.alert(
          "Battery Optimization Required",
          "To track sleep continuously for 6-8 hours, battery optimization must be disabled.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: async () => {
                const result = await AsleepSDK.requestBatteryOptimizationExemption();
                if (!result) {
                  console.log("🔋 Battery settings opened, user needs to disable optimization");
                }
              }
            }
          ]
        );
      }

      await setup({
        apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
        enableODA: true,
      });

      await initAsleepConfig({
        apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
        userId: _astId ?? undefined,
      });

      console.log("🐤 SDK initialized successfully");
    } catch (error: any) {
      console.error("initSDK error:", error);
      Alert.alert(
        "Error",
        `Failed to initialize SDK: ${error?.message || String(error)}`
      );
    }
  };

  const getReportListWrapper = useCallback(
    async (fromDate: string, toDate: string) => {
      try {
        return await getReportList(fromDate, toDate);
      } catch (error) {
        console.error("getReportListWrapper error:", error);
        // Wait 2 seconds and retry even on error
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          return await getReportList(fromDate, toDate);
        } catch (error) {
          console.error("getReportListWrapper retry error:", error);
        }
      }
    },
    [getReportList]
  );

  const fetchReportList = useCallback(async () => {
    console.log("fetchReportList, isInitialized", isInitialized);
    if (!isInitialized) return;

    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const fromDate = lastWeek.toISOString().split("T")[0];
    const toDate = today.toISOString().split("T")[0];

    const reportList = await getReportListWrapper(fromDate, toDate);
    setReportList(reportList ?? []);
  }, [isInitialized, getReportListWrapper]);

  const checkPermissionAndStartTracking = async () => {
    if (isSetupInProgress) {
      console.log(
        "🐤 Setup is in progress. Please try again after completion."
      );
      Alert.alert(
        "Notice",
        "Setup is in progress. Please try again after completion."
      );
      return;
    }

    await startTrackingWrapper();
  };

  return {
    startTracking: startTrackingWrapper,
    stopTracking: stopTrackingWrapper,
    initSDK,
    isInitialized,
    tryStopTracking,
    getReport,
    getReportList: getReportListWrapper,
    reportList,
    fetchReportList,
    shouldStopTracking,
    trackingStartTime,
    astId,
    checkPermissionAndStartTracking,
    isTracking,
    analysisResult,
    sessionId,
    error,
    didClose,
    log,
    userId: astId,
    isODAEnabled,
    isAnalyzing,
    requestAnalysis,
    enableLog,
    isTrackingPaused,
    getTrackingDurationMinutes,
    isSetupInProgress,
    isSetupComplete,
  };
};

// Export store for direct access
export { useTrackingStore };
