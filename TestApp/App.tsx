import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Switch,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { useAsleep, AsleepSDK, AsleepEventType } from "../src";

// Log data type
interface LogData {
  type: number; // 0: result, 1: info, 2: debug
  message: string;
}

const App = () => {
  // API Keys (same as Android TestApp)
  const apiKeyCloud = "Gbvw2ubfsld7a67jdnngjjislwogr0r3kufjzurw";
  const apiKeyOda = "5LSjVdV7vro0RrOJTRz3E7Pv3jGshF5Y6Yd9Cwuf";

  // State for inputs
  const [setupApiKey, setSetupApiKey] = useState("");
  const [setupBaseUrl, setSetupBaseUrl] = useState("");
  const [setupCallbackUrl, setSetupCallbackUrl] = useState("");
  const [setupService, setSetupService] = useState("");
  const [setupOdaEnabled, setSetupOdaEnabled] = useState(false);

  const [initApiKey, setInitApiKey] = useState("");
  const [initBaseUrl, setInitBaseUrl] = useState("");
  const [initCallbackUrl, setInitCallbackUrl] = useState("");
  const [initService, setInitService] = useState("");
  const [initUserId, setInitUserId] = useState("");

  const [sessionIdDelete, setSessionIdDelete] = useState("");
  const [sessionIdGet, setSessionIdGet] = useState("");
  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [offset, setOffset] = useState("");
  const [limit, setLimit] = useState("");
  const [orderBy, setOrderBy] = useState("DESC");

  const [asStartDate, setAsStartDate] = useState("");
  const [asEndDate, setAsEndDate] = useState("");

  // Logs
  const [logs, setLogs] = useState<LogData[]>([]);
  const [fullLog, setFullLog] = useState("");

  // Rotation for quick fill
  const [rotation, setRotation] = useState(0);

  const scrollViewRef = useRef<ScrollView>(null);

  // Asleep SDK hooks
  const {
    userId,
    sessionId,
    isInitialized,
    isTracking,
    setup,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    getAverageReport,
    deleteSession,
    requestAnalysis,
    analysisResult,
    enableLog,
    checkAndRestoreTracking,
  } = useAsleep();

  // Enable logging and check for active session on startup
  useEffect(() => {
    enableLog(true);

    // Check and restore tracking if there's an active session
    const initializeTracking = async () => {
      try {
        const result = await checkAndRestoreTracking();
        console.log("[App] checkAndRestoreTracking result:", result);
        if (result.hasActiveSession) {
          addLog(1, "Restored active tracking session");
        }
      } catch (error) {
        console.log("[App] checkAndRestoreTracking error:", error);
      }
    };

    initializeTracking();
  }, []);

  // Update initUserId when userId changes
  useEffect(() => {
    if (userId) {
      setInitUserId(userId);
    }
  }, [userId]);

  // Update sessionId inputs when sessionId changes (after stopTracking)
  useEffect(() => {
    if (sessionId) {
      setSessionIdDelete(sessionId);
      setSessionIdGet(sessionId);
    }
  }, [sessionId]);

  // Listen for tracking events and show in fullLog
  useEffect(() => {
    const uploadedSub = AsleepSDK.addEventListener("onTrackingUploaded", (data) => {
      const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
      setFullLog((prev) => `${prev}\n[${time}] onTrackingUploaded: seq=${data.sequence}`);
    });

    const analysisSub = AsleepSDK.addEventListener("onAnalysisResult", (data) => {
      const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
      setFullLog((prev) => `${prev}\n[${time}] onAnalysisResult:\n${JSON.stringify(data, null, 2)}`);
    });

    return () => {
      uploadedSub.remove();
      analysisSub.remove();
    };
  }, []);

  // Helper functions
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString("ko-KR", { hour12: false });
  };

  const addLog = (type: number, message: string) => {
    const time = getCurrentTime();
    setLogs((prev) => [...prev, { type, message: `[${time}] ${message}` }]);
  };

  const addFullLog = (message: string) => {
    setFullLog(message);
  };

  const clearFullLog = () => {
    setFullLog("");
  };

  // Quick fill function
  const handleSetupLabelPress = () => {
    const newRotation = (rotation + 1) % 3;
    setRotation(newRotation);

    if (newRotation === 0) {
      setTempEditText("", "", "", "");
    } else if (newRotation === 1) {
      setTempEditText(apiKeyCloud, "", "https://httpbin.org/delay/0", "test-app");
    } else if (newRotation === 2) {
      setTempEditText(apiKeyOda, "", "https://httpbin.org/delay/0", "test-app");
    }
  };

  const setTempEditText = (apiKey: string, baseUrl: string, callbackUrl: string, service: string) => {
    setSetupApiKey(apiKey);
    setSetupBaseUrl(baseUrl);
    setSetupCallbackUrl(callbackUrl);
    setSetupService(service);

    setInitApiKey(apiKey);
    setInitBaseUrl(baseUrl);
    setInitCallbackUrl(callbackUrl);
    setInitService(service);
  };

  // Permission handlers
  const handleMicPermission = async () => {
    if (Platform.OS === "android") {
      try {
        const audioGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );

        if (Platform.Version >= 33) {
          const notifGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
          addLog(1, `Audio: ${audioGranted}, Notification: ${notifGranted}`);
        } else {
          addLog(1, `Audio permission: ${audioGranted}`);
        }
      } catch (err) {
        addLog(0, `Permission error: ${err}`);
      }
    } else {
      addLog(1, "iOS: Permission handled by system");
    }
  };

  const handleBatteryOptimization = async () => {
    try {
      const status = await AsleepSDK.checkBatteryOptimization();
      if (status.exempted) {
        addLog(1, "Already IGNORE_BATTERY_OPTIMIZATIONS");
      } else {
        await AsleepSDK.requestBatteryOptimizationExemption();
        addLog(1, "Requested battery optimization exemption");
      }
    } catch (err) {
      addLog(0, `Battery optimization error: ${err}`);
    }
  };

  // Setup handler
  const handleSetup = async () => {
    try {
      addLog(2, "click setup");
      await setup({
        apiKey: setupApiKey,
        baseUrl: setupBaseUrl || undefined,
        callbackUrl: setupCallbackUrl || undefined,
        service: setupService || undefined,
        enableODA: setupOdaEnabled,
      });
      addLog(0, "setup complete");
      addFullLog("setup complete");
    } catch (err: any) {
      addLog(0, `setup fail: ${err.message}`);
      addFullLog(`setup fail: ${err.message}`);
    }
  };

  // Init handler
  const handleInit = async () => {
    try {
      addLog(2, "click initAsleepConfig");
      await initAsleepConfig({
        apiKey: initApiKey,
        userId: initUserId || undefined,
        baseUrl: initBaseUrl || undefined,
        callbackUrl: initCallbackUrl || undefined,
        service: initService || undefined,
      });
      addLog(0, "initAsleepConfig complete (userId will be set via onUserJoined event)");
    } catch (err: any) {
      addLog(0, `init fail: ${err.message}`);
      addFullLog(`init fail: ${err.message}`);
    }
  };

  // Log userId when it changes (from onUserJoined event)
  useEffect(() => {
    if (userId) {
      addLog(0, `userId = ${userId}`);
      addFullLog(userId);
    }
  }, [userId]);

  // Delete user handler
  const handleDeleteUser = async () => {
    addLog(2, "click delete UserId");
    addLog(0, "deleteUser not implemented yet");
  };

  // Sleep Tracking Manager handlers
  const handleCreateStm = () => {
    addLog(2, "click create sleep tracking manager");
    addLog(0, "SleepTrackingManager created (React Native manages internally)");
  };

  const handleStartStm = async () => {
    try {
      addLog(2, "click sleep tracking start");
      await startTracking({
        android: {
          notification: {
            title: "Asleep Tracking",
            text: "Sleep tracking in progress...",
          },
        },
      });
      addLog(0, "Tracking started");
    } catch (err: any) {
      addLog(0, `Start tracking error: ${err.message}`);
    }
  };

  const handleRequestAnalysis = async () => {
    try {
      addLog(2, "click get analysis");
      const result = await requestAnalysis();
      if (result) {
        addLog(0, `Analysis result: ${result.id}`);
        addFullLog(JSON.stringify(result, null, 2));
      }
    } catch (err: any) {
      addLog(0, `Analysis error: ${err.message}`);
    }
  };

  const handleTrackingStatus = () => {
    addLog(2, "click get tracking status");
    addLog(0, `isTracking: ${isTracking}, sessionId: ${sessionId}`);
    addFullLog(`sessionId: ${sessionId}`);
  };

  const handleStopStm = async () => {
    try {
      addLog(2, "click sleep tracking stop");
      await stopTracking();
      addLog(0, "Tracking stopped");
    } catch (err: any) {
      addLog(0, `Stop tracking error: ${err.message}`);
    }
  };

  // Report handlers
  const handleCreateReport = () => {
    addLog(2, "click create report");
    addLog(0, "Reports created (React Native manages internally)");
  };

  const handleDeleteReport = async () => {
    addLog(2, "click delete session");
    if (!sessionIdDelete) {
      addLog(0, "No session ID provided");
      return;
    }
    try {
      await deleteSession(sessionIdDelete);
      addLog(0, `[Success] Deleted session ${sessionIdDelete}`);
      addFullLog(sessionIdDelete);
    } catch (err: any) {
      addLog(0, `[Fail] ${err.message}`);
      addFullLog(err.message);
    }
  };

  const handleGetReport = async () => {
    addLog(2, "click get Report");
    if (!sessionIdGet) {
      addLog(0, "No session ID provided");
      return;
    }
    try {
      const report = await getReport(sessionIdGet);
      addLog(0, `[Success] ${report?.session?.id}`);
      addFullLog(JSON.stringify(report, null, 2));
    } catch (err: any) {
      addLog(0, `[Fail] ${err.message}`);
      addFullLog(err.message);
    }
  };

  const handleToggleOrder = () => {
    setOrderBy(orderBy === "DESC" ? "ASC" : "DESC");
  };

  const handleGetReports = async () => {
    addLog(2, "click get Reports");
    try {
      const reports = await getReportList(
        startDate,
        endDate,
        orderBy,
        parseInt(offset) || 0,
        parseInt(limit) || 20
      );
      addLog(0, `[Success] report size: ${reports?.length || 0}`);
      reports?.forEach((report: any, index: number) => {
        addLog(0, `${index}, ${report.id || report.sessionId}`);
      });
      addFullLog(JSON.stringify(reports, null, 2));
    } catch (err: any) {
      addLog(0, `[Fail] ${err.message}`);
      addFullLog(err.message);
    }
  };

  const handleAverageStat = async () => {
    addLog(2, "click get Average-Stat");
    try {
      const avgReport = await getAverageReport(asStartDate, asEndDate);
      addLog(0, "[Success] averageReport");
      addFullLog(JSON.stringify(avgReport, null, 2));
    } catch (err: any) {
      addLog(0, `[Fail] ${err.message}`);
      addFullLog(err.message);
    }
  };

  // Log colors
  const getLogColor = (type: number) => {
    switch (type) {
      case 0:
        return "#000000"; // result - black
      case 1:
        return "#0066cc"; // info - blue
      case 2:
        return "#666666"; // debug - gray
      default:
        return "#000000";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Permission Section */}
        <Text style={styles.sectionTitle}>permission</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={handleMicPermission}>
            <Text style={styles.buttonText}>Mic, push</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleBatteryOptimization}>
            <Text style={styles.buttonText}>Ignore Bat</Text>
          </TouchableOpacity>
        </View>

        {/* Setup Section */}
        <TouchableOpacity onPress={handleSetupLabelPress}>
          <Text style={styles.sectionTitle}>setup (tap to fill)</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="input setup apikey"
          placeholderTextColor="#aaa"
          value={setupApiKey}
          onChangeText={setSetupApiKey}
        />
        <TextInput
          style={styles.input}
          placeholder="input base URL"
          placeholderTextColor="#aaa"
          value={setupBaseUrl}
          onChangeText={setSetupBaseUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="input callback URL"
          placeholderTextColor="#aaa"
          value={setupCallbackUrl}
          onChangeText={setSetupCallbackUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="input service"
          placeholderTextColor="#aaa"
          value={setupService}
          onChangeText={setSetupService}
        />
        <View style={styles.row}>
          <View style={styles.switchContainer}>
            <Text style={styles.switchLabel}>ODA</Text>
            <Switch value={setupOdaEnabled} onValueChange={setSetupOdaEnabled} />
          </View>
          <TouchableOpacity style={styles.button} onPress={handleSetup}>
            <Text style={styles.buttonText}>setup</Text>
          </TouchableOpacity>
        </View>

        {/* Init Section */}
        <Text style={styles.sectionTitle}>init</Text>
        <TextInput
          style={styles.input}
          placeholder="input apikey"
          placeholderTextColor="#aaa"
          value={initApiKey}
          onChangeText={setInitApiKey}
        />
        <TextInput
          style={styles.input}
          placeholder="input base URL"
          placeholderTextColor="#aaa"
          value={initBaseUrl}
          onChangeText={setInitBaseUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="input callback URL"
          placeholderTextColor="#aaa"
          value={initCallbackUrl}
          onChangeText={setInitCallbackUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="input service"
          placeholderTextColor="#aaa"
          value={initService}
          onChangeText={setInitService}
        />
        <TextInput
          style={styles.input}
          placeholder="input userId"
          placeholderTextColor="#aaa"
          value={initUserId}
          onChangeText={setInitUserId}
        />
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={handleInit}>
            <Text style={styles.buttonText}>init asleep config</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleDeleteUser}>
            <Text style={styles.buttonText}>Delete User</Text>
          </TouchableOpacity>
        </View>

        {/* SleepTrackingManager Section */}
        <Text style={styles.sectionTitle}>sleepTrackingManager</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={handleCreateStm}>
            <Text style={styles.smallButtonText}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleStartStm}>
            <Text style={styles.smallButtonText}>Start</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleRequestAnalysis}>
            <Text style={styles.smallButtonText}>REQANLS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleTrackingStatus}>
            <Text style={styles.smallButtonText}>Status</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleStopStm}>
            <Text style={styles.smallButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>

        {/* Report Section */}
        <Text style={styles.sectionTitle}>report</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={handleCreateReport}>
            <Text style={styles.buttonText}>Create Report</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="SessionId"
            placeholderTextColor="#aaa"
            value={sessionIdDelete}
            onChangeText={setSessionIdDelete}
          />
          <TouchableOpacity style={styles.smallButton} onPress={handleDeleteReport}>
            <Text style={styles.smallButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="SessionId"
            placeholderTextColor="#aaa"
            value={sessionIdGet}
            onChangeText={setSessionIdGet}
          />
          <TouchableOpacity style={styles.smallButton} onPress={handleGetReport}>
            <Text style={styles.smallButtonText}>Get Report</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Start Date"
            placeholderTextColor="#aaa"
            value={startDate}
            onChangeText={setStartDate}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="End Date"
            placeholderTextColor="#aaa"
            value={endDate}
            onChangeText={setEndDate}
          />
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.smallButton, { backgroundColor: "#6495ED" }]} onPress={handleToggleOrder}>
            <Text style={styles.smallButtonText}>{orderBy}</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="offset"
            placeholderTextColor="#aaa"
            value={offset}
            onChangeText={setOffset}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Limit"
            placeholderTextColor="#aaa"
            value={limit}
            onChangeText={setLimit}
            keyboardType="numeric"
          />
          <TouchableOpacity style={styles.smallButton} onPress={handleGetReports}>
            <Text style={styles.smallButtonText}>Get Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={clearFullLog}>
            <Text style={styles.smallButtonText}>Clear F/log</Text>
          </TouchableOpacity>
        </View>

        {/* Average-Stat Section */}
        <Text style={styles.sectionTitle}>Average-Stat</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Start Date"
            placeholderTextColor="#aaa"
            value={asStartDate}
            onChangeText={setAsStartDate}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="End Date"
            placeholderTextColor="#aaa"
            value={asEndDate}
            onChangeText={setAsEndDate}
          />
          <TouchableOpacity style={styles.smallButton} onPress={handleAverageStat}>
            <Text style={styles.smallButtonText}>Average-Stat</Text>
          </TouchableOpacity>
        </View>

        {/* Logs Section */}
        <View style={styles.logsContainer}>
          {/* Simple Log */}
          <ScrollView
            style={styles.simpleLog}
            ref={scrollViewRef}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd()}
          >
            {logs.map((log, index) => (
              <Text key={index} style={[styles.logText, { color: getLogColor(log.type) }]}>
                {log.message}
              </Text>
            ))}
          </ScrollView>

          {/* Full Log */}
          <ScrollView style={styles.fullLog}>
            <Text style={styles.fullLogText} selectable>
              {fullLog}
            </Text>
          </ScrollView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  scrollView: {
    flex: 1,
    padding: 4,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    paddingLeft: 10,
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
    marginVertical: 2,
  },
  input: {
    height: 36,
    backgroundColor: "#fff",
    marginHorizontal: 2,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#000",
    borderRadius: 4,
    textAlignVertical: "center",
  },
  button: {
    flex: 1,
    height: 36,
    backgroundColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 2,
    borderRadius: 4,
  },
  buttonText: {
    fontSize: 12,
    color: "#000",
  },
  smallButton: {
    height: 36,
    backgroundColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 2,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  smallButtonText: {
    fontSize: 10,
    color: "#000",
  },
  switchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    backgroundColor: "#6495ED",
    marginHorizontal: 2,
    borderRadius: 4,
  },
  switchLabel: {
    fontSize: 12,
    color: "#fff",
    marginRight: 5,
  },
  logsContainer: {
    flexDirection: "row",
    height: 400,
    marginTop: 5,
  },
  simpleLog: {
    flex: 1,
    backgroundColor: "#fff",
    marginRight: 2,
    padding: 5,
  },
  fullLog: {
    flex: 1,
    backgroundColor: "#fff",
    marginLeft: 2,
    padding: 5,
  },
  logText: {
    fontSize: 10,
    marginBottom: 2,
  },
  fullLogText: {
    fontSize: 10,
    color: "#000",
  },
});

export default App;
