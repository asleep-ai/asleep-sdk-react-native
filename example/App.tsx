import moment from "moment";
import React, { useEffect, useState } from "react";
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAsleep, AsleepSession } from "../src";

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);

  const {
    userId,
    sessionId,
    isTracking,
    error,
    log,
    startTracking,
    stopTracking,
    initAsleepConfig,
    getReport,
    getReportList,
    enableLog,
  } = useAsleep();

  const addLog = (message: string) => {
    console.log("message", message);
    setLogs((prevLogs) => [
      ...prevLogs,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  // initialize SDK
  useEffect(() => {
    const initSDK = async () => {
      try {
        enableLog(SHOW_DEBUG_LOG);
        await initAsleepConfig({
          apiKey: API_KEY,
        });
        addLog("SDK initialized successfully");
      } catch (error: any) {
        addLog(`Initialization error: ${error.message}`);
      }
    };

    initSDK();
  }, []);

  // monitor error state
  useEffect(() => {
    if (error) {
      addLog(`Error: ${error}`);
    }
  }, [error]);

  // monitor log state
  useEffect(() => {
    if (log && SHOW_DEBUG_LOG) {
      addLog(`SDK Log: ${log}`);
    }
  }, [log]);

  // monitor session ID change
  useEffect(() => {
    if (sessionId) {
      addLog(`Session ID updated: ${sessionId}`);
    }
  }, [sessionId]);

  // monitor user ID change
  useEffect(() => {
    if (userId) {
      addLog(`User ID updated: ${userId}`);
    }
  }, [userId]);

  const _startTracking = async () => {
    try {
      await startTracking();
      addLog("Tracking started");
    } catch (error: any) {
      addLog(`Start error: ${error.message}`);
    }
  };

  const _stopTracking = async () => {
    try {
      await stopTracking();
      addLog("Tracking stopped");
    } catch (error: any) {
      addLog(`Stop error: ${error.message}`);
    }
  };

  const _getReport = async () => {
    if (!sessionId) {
      addLog("No session ID available");
      return;
    }

    try {
      const report = await getReport(sessionId);
      if (report) {
        addLog(`Report received: ${JSON.stringify(report, null, 2)}`);
      } else {
        addLog("No report available");
      }
    } catch (error: any) {
      addLog(`Get report error: ${error.message}`);
    }
  };

  const _getReportList = async () => {
    try {
      const today = moment();
      const fromDate = today.clone().subtract(1, "month").format("YYYY-MM-DD");
      const toDate = today.format("YYYY-MM-DD");

      const reports = await getReportList(fromDate, toDate);
      addLog(`Report list received: ${reports.length} reports`);

      if (reports.length > 0) {
        reports.forEach((report: AsleepSession, index: number) => {
          addLog(`Report ${index + 1}: ${JSON.stringify(report, null, 2)}`);
        });
      }
    } catch (error: any) {
      addLog(`Get report list error: ${error.message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>User ID: {userId || "Not set"}</Text>
          <Text style={styles.statusText}>
            Session ID: {sessionId || "Not set"}
          </Text>
          <Text style={styles.statusText}>
            Tracking Status: {isTracking ? "🔴 Tracking" : "⚪ Not Tracking"}
          </Text>
          {error && <Text style={styles.errorText}>Error: {error}</Text>}
        </View>

        <ScrollView style={styles.logContainer}>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText} selectable={true}>
              {log}
            </Text>
          ))}
          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.buttonContainer}>
          <Button
            title="Start Tracking"
            onPress={_startTracking}
            disabled={isTracking}
          />
          <Button
            title="Stop Tracking"
            onPress={_stopTracking}
            disabled={!isTracking}
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Get Report"
            onPress={_getReport}
            disabled={!sessionId}
          />
          <Button title="Get Report List" onPress={_getReportList} />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  statusContainer: {
    padding: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    marginBottom: 10,
  },
  statusText: {
    fontSize: 16,
    marginBottom: 5,
    fontWeight: "500",
  },
  errorText: {
    fontSize: 14,
    color: "red",
    marginTop: 5,
  },
  logContainer: {
    flex: 1,
    marginTop: 10,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
  },
  logText: {
    fontSize: 12,
    marginBottom: 5,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 5,
  },
});

export default App;
