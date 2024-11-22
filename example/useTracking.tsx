import { useCallback, useEffect, useState } from "react";

import asleep, { useAsleep, AsleepSession } from "react-native-asleep";

import { create } from "zustand";

const useTrackingStore = create<{
  trackingStartTime: number | null;
  setTrackingStartTime: (time: number | null) => void;
  hasBeen30Minutes: boolean;
  setHasBeen30Minutes: (flag: boolean) => void;
  showTrackingStopModal: boolean;
  setShowTrackingStopModal: (flag: boolean) => void;
  reportList: AsleepSession[];
  setReportList: (reportList: AsleepSession[]) => void;
  didInitSDK: boolean;
  setDidInitSDK: (flag: boolean) => void;
}>((set) => ({
  trackingStartTime: null,
  setTrackingStartTime: (time) => set({ trackingStartTime: time }),
  hasBeen30Minutes: false,
  setHasBeen30Minutes: (flag) => set({ hasBeen30Minutes: flag }),
  showTrackingStopModal: false,
  setShowTrackingStopModal: (flag) => set({ showTrackingStopModal: flag }),
  reportList: [],
  setReportList: (reportList) => set({ reportList }),
  didInitSDK: false,
  setDidInitSDK: (flag) => set({ didInitSDK: flag }),
}));

export const useTracking = () => {
  const {
    userId,
    startTracking,
    stopTracking,
    initAsleepConfig,
    setCustomNotification,
    getReport,
    getReportList,
    ...asleepMethods
  } = useAsleep();

  const {
    setTrackingStartTime,
    trackingStartTime,
    hasBeen30Minutes,
    setHasBeen30Minutes,
    setShowTrackingStopModal,
    showTrackingStopModal,
    reportList,
    setReportList,
    didInitSDK,
    setDidInitSDK,
  } = useTrackingStore();

  const [shouldStopTracking, setShouldStopTracking] = useState(false);

  const startTrackingWrapper = async () => {
    try {
      await startTracking();
      setTrackingStartTime(Date.now());
      setHasBeen30Minutes(false);
    } catch (error) {
      setShouldStopTracking(true);
      stopTracking();
      console.error("startTrackingWrapper error:", error);
    }
  };

  const updateCustomNotification = async () => {
    try {
      const title = "Asleep";
      const text = "Tracking...";
      await setCustomNotification(title, text);
    } catch (error) {
      console.error("updateCustomNotification error:", error);
    }
  };

  const stopTrackingWrapper = async () => {
    await stopTracking();
    setTrackingStartTime(null);
    setHasBeen30Minutes(false);
  };

  const hasBeen30 = () => {
    if (!trackingStartTime) return false;
    const hasBeen30 = Date.now() - trackingStartTime >= 30 * 60 * 1000;
    setHasBeen30Minutes(hasBeen30);
    return hasBeen30;
  };

  const tryStopTracking = () => {
    if (hasBeen30()) {
      stopTrackingWrapper();
      return true;
    } else {
      setShowTrackingStopModal(true);
      return false;
    }
  };

  const initSDK = async () => {
    try {
      console.log("initSDK");

      await initAsleepConfig({
        apiKey: process.env.EXPO_PUBLIC_ASLEEP_API_KEY || "",
      });
      console.log("initSDK, didInitSDK", didInitSDK);
      console.log(
        "initSDK, process.env.EXPO_PUBLIC_ASLEEP_API_KEY",
        process.env.EXPO_PUBLIC_ASLEEP_API_KEY
      );
      setDidInitSDK(true);
      await updateCustomNotification();
    } catch (error) {
      console.error("initSDK error:", error);
    }
  };

  const getReportListWrapper = async (fromDate: string, toDate: string) => {
    try {
      return await getReportList(fromDate, toDate);
    } catch (error) {
      console.error("getReportListWrapper error:", error);
      // 에러 발생 시에도 2초 대기 후 다시 시도
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        return await getReportList(fromDate, toDate);
      } catch (error) {
        console.error("getReportListWrapper error:", error);
      }
    }
  };

  const isTrackingService = useCallback(() => {
    return asleep.isTracking();
  }, []);

  const fetchReportList = async () => {
    console.log("fetchReportList, didInitSDK", didInitSDK);
    if (!didInitSDK) return;

    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);

    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const reportList = await getReportListWrapper(
      formatDate(lastWeek),
      formatDate(today)
    );
    setReportList(reportList ?? []);
  };

  return {
    startTracking: startTrackingWrapper,
    stopTracking: stopTrackingWrapper,
    initSDK,
    didInitSDK,
    tryStopTracking,
    // getReport,
    getReportList: getReportListWrapper,
    reportList,
    // ...asleepMethods,
    fetchReportList,
    showTrackingStopModal,
    setShowTrackingStopModal,
    shouldStopTracking,
    isTrackingService,
  };
};
