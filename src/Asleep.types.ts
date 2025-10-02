export type AsleepConfig = {
  apiKey: string;
  userId?: string;
  baseUrl?: string;
  callbackUrl?: string;
};

export type AsleepSetupConfig = {
  apiKey: string;
  baseUrl?: string;
  callbackUrl?: string;
  service?: string;
  enableODA?: boolean;
};

export type AsleepReport = {
  timezone: string;
  session: {
    id: string;
    createdTimezone: string;
    startTime: string;
    endTime?: string;
    unexpectedEndTime?: string;
    state: string;
    sleepStages?: number[];
    breathStages?: number[];
    snoringStages?: number[];
  };
  missingDataRatio: number;
  peculiarities: string[];
  stat?: AsleepStat;
};

export type AsleepStat = {
  sleepCycleTime?: number[];
  timeInStableBreath?: number;
  timeInBed?: number;
  unstableBreathRatio?: number;
  sleepCycle?: number;
  timeInSleep?: number;
  breathingIndex?: number;
  deepLatency?: number;
  remLatency?: number;
  timeInSnoring?: number;
  wakeTime?: string;
  longestWaso?: number;
  lightRatio?: number;
  noSnoringRatio?: number;
  snoringCount?: number;
  unstableBreathCount?: number;
  timeInDeep?: number;
  sleepTime?: string;
  sleepCycleCount?: number;
  wakeupLatency?: number;
  breathingPattern?: string;
  timeInRem?: number;
  snoringRatio?: number;
  stableBreathRatio?: number;
  timeInSleepPeriod?: number;
  lightLatency?: number;
  remRatio?: number;
  sleepEfficiency?: number;
  timeInNoSnoring?: number;
  sleepLatency?: number;
  timeInLight?: number;
  sleepIndex?: number;
  sleepRatio?: number;
  timeInUnstableBreath?: number;
  wasoCount?: number;
  wakeRatio?: number;
  deepRatio?: number;
  timeInWake?: number;
};

// From getReportList() - maps to SDK SleepSession
export type AsleepSession = {
  id: string;  // mapped from sessionId
  state: string;
  startTime: string;  // mapped from sessionStartTime
  endTime?: string;  // mapped from sessionEndTime
  createdTimezone: string;
  unexpectedEndTime?: string;
  lastReceivedSeqNum?: number;
  timeInBed?: number;
};

// From getAverageReport() sleptSessions - maps to SDK SleptSession
export type AsleepSleptSession = {
  id: string;
  createdTimezone: string;
  startTime: string;
  endTime: string;
  completedTime: string;
  sleepEfficiency: number;
  sleepLatency?: number;
  wakeupLatency?: number;
  lightLatency?: number;
  deepLatency?: number;
  remLatency?: number;
  sleepTime?: string;
  wakeTime?: string;
  timeInWake: number;
  timeInSleepPeriod: number;
  timeInSleep: number;
  timeInBed: number;
  timeInRem?: number;
  timeInLight?: number;
  timeInDeep?: number;
  timeInStableBreath?: number;
  timeInUnstableBreath?: number;
  timeInSnoring?: number;
  timeInNoSnoring?: number;
  wakeRatio: number;
  sleepRatio: number;
  remRatio?: number;
  lightRatio?: number;
  deepRatio?: number;
  stableBreathRatio?: number;
  unstableBreathRatio?: number;
  snoringRatio?: number;
  noSnoringRatio?: number;
  unstableBreathCount?: number;
  breathingPattern?: string;
  breathingIndex?: number;
  sleepCycle?: number;
  sleepCycleCount?: number;
  wasoCount?: number;
  longestWaso?: number;
  snoringCount?: number;
};

// From getAverageReport() neverSleptSessions - maps to SDK NeverSleptSession
export type AsleepNeverSleptSession = {
  id: string;
  startTime: string;
  endTime: string;
  completedTime: string;
};

export type AsleepAverageReport = {
  period: {
    timezone: string;
    startDate: string;
    endDate: string;
  };
  peculiarities: string[];
  averageStats?: AsleepStat;
  neverSleptSessions?: AsleepNeverSleptSession[];
  sleptSessions?: AsleepSleptSession[];
};

export type AsleepAnalysisResult = {
  id?: string;
  state?: string;
  startTime?: string;
  endTime?: string;
  sleepStages?: number[];
  breathStages?: number[];
  snoringStages?: number[];
};

export type TrackingConfig = {
  android?: {
    notification?: {
      title?: string;
      text?: string;
      icon?: string;
    };
  };
};

export type AsleepEventType = {
  onTrackingCreated: { sessionId?: string };
  onTrackingUploaded: { sequence: number };
  onTrackingClosed: { sessionId: string };
  onTrackingFailed: undefined;
  onTrackingInterrupted: undefined;
  onTrackingResumed: undefined;
  onMicPermissionDenied: undefined;
  onUserJoined: undefined;
  onUserJoinFailed: undefined;
  onUserDeleted: undefined;
  onDebugLog: { message: string };
  onSetupDidComplete: undefined;
  onSetupDidFail: { error: string };
  onSetupInProgress: { progress: number };
  onAnalysisResult: AsleepAnalysisResult;
};
