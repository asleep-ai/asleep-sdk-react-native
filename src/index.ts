import { EventEmitter } from "expo-modules-core";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
} from "./Asleep.types";
import AsleepModule from "./AsleepModule";
import { useAsleepStore, initializeAsleepListeners } from "./AsleepStore";

const emitter = new EventEmitter(AsleepModule);

class Asleep {
  private listeners: {
    [K in keyof AsleepEventType]?: ((data: AsleepEventType[K]) => void)[];
  } = {};

  setup = async (config: AsleepSetupConfig): Promise<void> => {
    try {
      await AsleepModule.setup(
        config.apiKey,
        config.baseUrl,
        config.callbackUrl,
        config.service,
        config.enableODA
      );
    } catch (error) {
      console.error("setup error:", error);
      throw error;
    }
  };

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
  const {
    didClose,
    isTracking,
    error,
    userId,
    sessionId,
    log,
    setup,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    enableLog,
    setCustomNotification,
  } = useAsleepStore();

  useEffect(() => {
    const cleanup = initializeAsleepListeners();
    return cleanup;
  }, []);

  return {
    didClose,
    error,
    userId,
    sessionId,
    log,
    enableLog,
    setCustomNotification,
    setup,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    isTracking,
  };
};

export const asleepStore = useAsleepStore;

export const AsleepSDK = {
  setup: (config: AsleepSetupConfig) => useAsleepStore.getState().setup(config),

  initAsleepConfig: (config: AsleepConfig) =>
    useAsleepStore.getState().initAsleepConfig(config),

  startTracking: () => useAsleepStore.getState().startTracking(),

  stopTracking: () => useAsleepStore.getState().stopTracking(),

  getReport: (sessionId: string) =>
    useAsleepStore.getState().getReport(sessionId),

  getReportList: (fromDate: string, toDate: string) =>
    useAsleepStore.getState().getReportList(fromDate, toDate),

  isTracking: () => useAsleepStore.getState().isTracking,

  getUserId: () => useAsleepStore.getState().userId,

  getSessionId: () => useAsleepStore.getState().sessionId,

  enableLog: (print: boolean) => useAsleepStore.getState().enableLog(print),

  setCustomNotification: (title: string, text: string) =>
    useAsleepStore.getState().setCustomNotification(title, text),

  initialize: () => {
    return initializeAsleepListeners();
  },
};

const asleep = new Asleep();
export default asleep;

export type {
  AsleepConfig,
  AsleepSetupConfig,
  AsleepEventType,
  AsleepReport,
  AsleepSession,
  AsleepStat,
} from "./Asleep.types";
