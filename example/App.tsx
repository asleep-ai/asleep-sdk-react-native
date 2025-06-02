import moment from "moment";
import React, { useEffect, useState } from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAsleep } from "../src";

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);

  const {
    userId,
    sessionId,
    error,
    log,
    isTracking,
    setup,
    initAsleepConfig,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    enableLog,
  } = useAsleep();

  useEffect(() => {
    const initSDK = async () => {
      try {
        // Enable debug logging
        enableLog(SHOW_DEBUG_LOG);

        // Regular initialization (same as before)
        await initAsleepConfig({
          apiKey: API_KEY,
        });
        addLog("SDK initialized");
      } catch (error: any) {
        addLog(`Initialization error: ${error.message}`);
      }
    };

    initSDK();
  }, []);

  // useAsleep hook
  useEffect(() => {
    if (log) {
      setLogs((prevLogs) => [...prevLogs, log]);
    }
  }, [log]);

  // error
  useEffect(() => {
    if (error) {
      addLog(`Error: ${error}`);
    }
  }, [error]);

  const addLog = (message: string) => {
    console.log("message", message);
    setLogs((prevLogs) => [
      ...prevLogs,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

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
      addLog("No session ID");
      return;
    }
    try {
      const report = await getReport(sessionId);
      if (report) {
        addLog(`Report retrieved for session: ${sessionId}`);
        if (report.stat?.sleepIndex) {
          addLog(`Sleep index: ${report.stat.sleepIndex}`);
        }
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

      const reportList = await getReportList(fromDate, toDate);
      addLog(`Retrieved ${reportList.length} reports`);
    } catch (error: any) {
      addLog(`Get report list error: ${error.message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <View>
          <Text>User ID: {userId}</Text>
          <Text>Session ID: {sessionId}</Text>
          <Text>
            Tracking Status: {isTracking ? "Tracking" : "Not Tracking"}
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
          <Button title="Start Tracking" onPress={_startTracking} />
          <Button title="Stop Tracking" onPress={_stopTracking} />
        </View>

        <View style={styles.buttonContainer}>
          <Button title="Get Report" onPress={_getReport} />
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
  logContainer: {
    flex: 1,
    marginTop: 20,
    marginBottom: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: "black",
  },
  logText: {
    fontSize: 14,
    marginBottom: 5,
  },
  errorText: {
    color: "red",
    fontSize: 14,
    marginTop: 5,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export default App;
