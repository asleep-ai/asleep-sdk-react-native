export type AsleepConfig = {
  apiKey: string;
  userId?: string;
  baseUrl?: string;
  callbackUrl?: string;
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

export type AsleepSession = {
  sessionId: string;
  state: string;
  sessionStartTime: string;
  sessionEndTime?: string;
  timeInBed?: number;
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
};
