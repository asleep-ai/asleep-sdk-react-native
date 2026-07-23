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
  id: string; // mapped from sessionId
  state: string;
  startTime: string; // mapped from sessionStartTime
  endTime?: string; // mapped from sessionEndTime
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

// iOS resolves requestAnalysis with an ack while the real payload arrives via the
// onAnalysisResult event. Android resolves with the full AsleepAnalysisResult and also
// fires the event. Consumers reading the promise return value should narrow on `status`.
export type AsleepAnalysisAck = {
  status: "requested";
  timestamp: number;
};

export type AudioSessionOption = "duckOthers" | "allowAirPlay" | "allowBluetooth" | "allowBluetoothA2DP";

export type TrackingConfig = {
  android?: {
    notification?: {
      title?: string;
      text?: string;
      icon?: string;
    };
  };
  ios?: {
    /** Additional AVAudioSession options appended to SDK defaults (mixWithOthers, allowBluetoothA2DP, defaultToSpeaker). Options reset on each startTracking() call. */
    audioSessionOptions?: AudioSessionOption[];
  };
};

/**
 * Coarse classification of a tracking-runtime failure (onTrackingFailed),
 * derived from the native error code. The library reports the objective fact;
 * the app decides log severity. Recommended mapping:
 * - "terminal" / "recordingDead" → error (session or recorder is gone)
 * - "recoveryRequired" / "transient" → warning (tracking is still alive and a
 *   defined recovery path exists)
 * - "unknown" → error (unclassified; do not assume it is benign)
 */
export type AsleepErrorCategory = "terminal" | "recordingDead" | "recoveryRequired" | "transient" | "unknown";

/**
 * Structured view of the last onTrackingFailed event, exposed as
 * useAsleep().errorInfo alongside the legacy `error` JSON string. Cleared to
 * null wherever `error` is cleared.
 */
export type AsleepErrorInfo = {
  /** Stable string code from the native module (e.g. "UPLOAD_TRACKING_TERMINATED"). */
  code: string;
  category: AsleepErrorCategory;
  /**
   * Numeric code documented by the native Asleep SDKs (range 10000-34999):
   * iOS `AsleepError.errorCode.code` (v3.2.0+), Android listener `errorCode`.
   */
  sdkCode?: number;
  message?: string;
  /** iOS: Swift enum case description for cases without an explicit code mapping. */
  caseName?: string;
};

export type AsleepEventType = {
  onTrackingCreated: { sessionId?: string };
  onTrackingUploaded: { sequence: number };
  onTrackingClosed: { sessionId: string };
  onTrackingFailed: {
    error: string;
    code: string;
    message?: string;
    /**
     * @deprecated On iOS this is the Swift enum declaration ordinal from
     * NSError bridging, not the documented Asleep error code. Use `sdkCode`.
     */
    errorCode?: number;
    /** Numeric code documented by the native Asleep SDKs (both platforms). */
    sdkCode?: number;
    caseName?: string;
  };
  onTrackingInterrupted: undefined;
  onTrackingResumed: undefined;
  onMicPermissionDenied: undefined;
  onUserJoined: { userId: string };
  onUserJoinFailed: {
    error?: string;
    errorCode?: number;
    detail?: string;
    caseName?: string;
    code?: number;
    /** Numeric code documented by the native Asleep SDKs (both platforms). */
    sdkCode?: number;
  };
  onUserDeleted: { userId: string };
  onDebugLog: { message: string };
  onSetupDidComplete: undefined;
  onSetupDidFail: {
    error: string;
    /** Numeric code documented by the native Asleep SDKs (both platforms). */
    sdkCode?: number;
  };
  onSetupInProgress: { progress: number };
  onAnalysisResult: AsleepAnalysisResult;
};
