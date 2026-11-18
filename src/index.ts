import { useEffect } from "react";
import type { AsleepEventType } from "./Asleep.types";
import {
  asleepActions,
  initializeAsleepListeners,
  toPublicState,
  useAsleepStore,
  type AsleepPublicApi,
} from "./AsleepStore";

export const useAsleep = (): AsleepPublicApi => {
  const state = useAsleepStore(toPublicState);

  useEffect(() => {
    return initializeAsleepListeners();
  }, []);

  return state;
};

export const Asleep = {
  initialize: initializeAsleepListeners,
  getState: (): AsleepPublicApi => toPublicState(useAsleepStore.getState()),
  subscribe: (listener: (state: AsleepPublicApi) => void): (() => void) => {
    let previous = toPublicState(useAsleepStore.getState());
    return useAsleepStore.subscribe(() => {
      const next = toPublicState(useAsleepStore.getState());
      if (next === previous) return;
      previous = next;
      listener(next);
    });
  },
  addEventListener: <K extends keyof AsleepEventType>(
    eventType: K,
    listener: (data: AsleepEventType[K]) => void,
  ): (() => void) => asleepActions.addEventListener(eventType, listener),
};

export { AsleepError } from "./Asleep.types";

export type {
  AsleepAnalysisAck,
  AsleepAnalysisRange,
  AsleepAnalysisResult,
  AsleepAverageReport,
  AsleepConfig,
  AsleepCredentials,
  AsleepErrorCategory,
  AsleepEventType,
  AsleepGender,
  AsleepNeverSleptSession,
  AsleepProductIdentifierType,
  AsleepProductInfo,
  AsleepReport,
  AsleepSession,
  AsleepSetupConfig,
  AsleepSleptSession,
  AsleepStat,
  AsleepUserMetadata,
  AudioSessionOption,
  ReanalyzeOptions,
  SetupStatus,
  StopTrackingOptions,
  TrackingConfig,
  TrackingStatus,
} from "./Asleep.types";
export type { AsleepActions, AsleepPublicApi, AsleepPublicState } from "./AsleepStore";
