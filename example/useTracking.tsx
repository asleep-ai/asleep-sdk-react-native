import { useCallback, useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAsleep, AsleepSession } from "../src";
import { create } from "zustand";

// Zustand 스토어 인터페이스
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

// Zustand 스토어 생성
const useTrackingStore = create<TrackingState>((set) => ({
  // 초기 상태
  shouldStopTracking: false,
  reportList: [],
  trackingStartTime: null,
  astId: null,

  // 상태 업데이트 함수들
  setShouldStopTracking: (should) => set({ shouldStopTracking: should }),
  setReportList: (list) => set({ reportList: list }),
  setTrackingStartTime: (time) => set({ trackingStartTime: time }),
  setAstId: (id) => set({ astId: id }),
}));

export const useTracking = () => {
  const {
    userId: asleepUserId,
    sessionId,
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
  } = useAsleep();

  // Zustand 스토어 사용
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

  // SDK 초기화
  useEffect(() => {
    enableLog(true);
    console.log("🐤 isInitialized", isInitialized);
    if (!isInitialized) {
      initSDK();
    }
  }, [isInitialized]);

  // 트래킹 상태가 변경될 때 시작 시간 관리
  useEffect(() => {
    if (isTracking && !trackingStartTime) {
      setTrackingStartTime(Date.now());
    } else if (!isTracking) {
      setTrackingStartTime(null);
    }
  }, [isTracking]);

  // astId 설정
  useEffect(() => {
    if (asleepUserId) {
      console.log("asleepUserId (astId):", asleepUserId);
      setAstId(asleepUserId);
    }
  }, [asleepUserId]);

  const startTrackingWrapper = async () => {
    try {
      if (!isTracking) {
        await startTracking();
        setTrackingStartTime(Date.now());
        console.log("🐤 Tracking started");
      }
    } catch (error) {
      setShouldStopTracking(true);
      stopTracking();
      console.error("startTrackingWrapper error:", error);
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
      Alert.alert("트래킹 중지", "30분 미만입니다. 정말 중지하시겠습니까?", [
        { text: "취소", style: "cancel" },
        { text: "중지", onPress: stopTrackingWrapper },
      ]);
      return false;
    }
  };

  const initSDK = async (preferredAstId?: string) => {
    try {
      const _astId = preferredAstId || astId;
      console.log("initSDK astId:", _astId);

      await setup({
        apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
        enableODA: true,
      });

      await initAsleepConfig({
        apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
        userId: _astId ?? undefined,
      });

      console.log("🐤 SDK initialized successfully");
    } catch (error) {
      console.error("initSDK error:", error);
    }
  };

  const getReportListWrapper = useCallback(
    async (fromDate: string, toDate: string) => {
      try {
        return await getReportList(fromDate, toDate);
      } catch (error) {
        console.error("getReportListWrapper error:", error);
        // 에러 발생 시에도 2초 대기 후 다시 시도
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
    // 간단히 바로 시작
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
  };
};

// 스토어를 직접 접근할 수 있도록 export
export { useTrackingStore };
