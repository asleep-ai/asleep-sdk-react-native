import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import Asleep from "react-native-asleep";

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const onUserJoined = (data: any) => {
      addLog(`User joined: ${data.userId}`);
      setUserId(data.userId);
    };
    const onUserJoinFailed = (error: any) =>
      addLog(`User join failed: ${error.error}`);
    const onUserDeleted = (data: any) => addLog(`User deleted: ${data.userId}`);
    const onTrackingCreated = () => addLog("Tracking created");
    const onTrackingUploaded = (data: any) =>
      addLog(`Tracking uploaded: ${data.sequence}`);
    const onTrackingClosed = (data: { sessionId: string }) => {
      addLog(`Tracking closed: ${data.sessionId}`);
      setSessionId(data.sessionId);
    };
    const onTrackingFailed = (error: any) =>
      addLog(`Tracking failed: ${error.error}`);
    const onTrackingInterrupted = () => addLog("Tracking interrupted");
    const onTrackingResumed = () => addLog("Tracking resumed");
    const onMicPermissionDenied = () => addLog("Microphone permission denied");
    const onDebugLog = (data: any) => {
      if (SHOW_DEBUG_LOG) {
        addLog(`Debug log: ${data.message}`);
      }
    };

    const userJoinedListener = Asleep.addEventListener(
      "onUserJoined",
      onUserJoined
    );
    const userJoinFailedListener = Asleep.addEventListener(
      "onUserJoinFailed",
      onUserJoinFailed
    );
    const userDeletedListener = Asleep.addEventListener(
      "onUserDeleted",
      onUserDeleted
    );
    const trackingCreatedListener = Asleep.addEventListener(
      "onTrackingCreated",
      onTrackingCreated
    );
    const trackingUploadedListener = Asleep.addEventListener(
      "onTrackingUploaded",
      onTrackingUploaded
    );
    const trackingClosedListener = Asleep.addEventListener(
      "onTrackingClosed",
      onTrackingClosed
    );
    const trackingFailedListener = Asleep.addEventListener(
      "onTrackingFailed",
      onTrackingFailed
    );
    const trackingInterruptedListener = Asleep.addEventListener(
      "onTrackingInterrupted",
      onTrackingInterrupted
    );
    const trackingResumedListener = Asleep.addEventListener(
      "onTrackingResumed",
      onTrackingResumed
    );
    const micPermissionDeniedListener = Asleep.addEventListener(
      "onMicPermissionDenied",
      onMicPermissionDenied
    );

    const debugLogListener = Asleep.addEventListener("onDebugLog", onDebugLog);

    const initSDK = async () => {
      try {
        await Asleep.initAsleepConfig({
          apiKey: API_KEY,
        });
        addLog("SDK initialized");
      } catch (error: any) {
        addLog(`Initialization error: ${error.message}`);
      }
    };

    initSDK();

    return () => {
      userJoinedListener.remove();
      userJoinFailedListener.remove();
      userDeletedListener.remove();
      trackingCreatedListener.remove();
      trackingUploadedListener.remove();
      trackingClosedListener.remove();
      trackingFailedListener.remove();
      trackingInterruptedListener.remove();
      trackingResumedListener.remove();
      micPermissionDeniedListener.remove();
      debugLogListener.remove();
    };
  }, []);

  const addLog = (message: string) => {
    console.log("message", message);
    setLogs((prevLogs) => [
      ...prevLogs,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  const startTracking = async () => {
    try {
      await Asleep.startTracking();
      addLog("Tracking started");
    } catch (error: any) {
      addLog(`Start error: ${error.message}`);
    }
  };

  const stopTracking = async () => {
    try {
      await Asleep.stopTracking();
      addLog("Tracking stopped");
    } catch (error: any) {
      addLog(`Stop error: ${error.message}`);
    }
  };

  const getReport = async () => {
    if (!sessionId) {
      addLog("Session ID is not set.");
      return;
    }

    try {
      console.log("sessionId", sessionId);
      const report = await Asleep.getReport(sessionId);
      addLog(`Report retrieved: ${JSON.stringify(report)}`);
    } catch (error: any) {
      addLog(`Report error: ${error.message}`);
    }
  };

  const getReportList = async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      // "YYYY-MM-DD"
      const yesterdayString = yesterday.toISOString().split("T")[0];
      const today = new Date();
      const todayString = today.toISOString().split("T")[0];
      const reportList = await Asleep.getReportList(
        yesterdayString,
        todayString
      );
      addLog(`Report list retrieved: ${JSON.stringify(reportList)}`);
    } catch (error: any) {
      addLog(`Report list error: ${error.message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <View>
          <Text>User ID: {userId}</Text>
          <Text>Session ID: {sessionId}</Text>
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
          <Button title="Start Tracking" onPress={startTracking} />
          <Button title="Stop Tracking" onPress={stopTracking} />
        </View>

        <View style={styles.buttonContainer}>
          <Button title="Get Report" onPress={getReport} />
          <Button title="Get Report List" onPress={getReportList} />
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
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export default App;
