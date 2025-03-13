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
import asleep, { useAsleep } from "react-native-asleep";

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);

  const [sessionId, setSessionId] = useState<string | null>(null);

  const {
    userId,
    startTracking,
    stopTracking,
    initAsleepConfig,
    getReport,
    getReportList,
    isTracking,
  } = useAsleep();

  useEffect(() => {
    const onUserJoined = (data: any) => {
      addLog(`User joined: ${data.userId}`);
      // setUserId(data.userId);
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

    const userJoinedListener = asleep.addEventListener(
      "onUserJoined",
      onUserJoined
    );
    const userJoinFailedListener = asleep.addEventListener(
      "onUserJoinFailed",
      onUserJoinFailed
    );
    const userDeletedListener = asleep.addEventListener(
      "onUserDeleted",
      onUserDeleted
    );
    const trackingCreatedListener = asleep.addEventListener(
      "onTrackingCreated",
      onTrackingCreated
    );
    const trackingUploadedListener = asleep.addEventListener(
      "onTrackingUploaded",
      onTrackingUploaded
    );
    const trackingClosedListener = asleep.addEventListener(
      "onTrackingClosed",
      onTrackingClosed
    );
    const trackingFailedListener = asleep.addEventListener(
      "onTrackingFailed",
      onTrackingFailed
    );
    const trackingInterruptedListener = asleep.addEventListener(
      "onTrackingInterrupted",
      onTrackingInterrupted
    );
    const trackingResumedListener = asleep.addEventListener(
      "onTrackingResumed",
      onTrackingResumed
    );
    const micPermissionDeniedListener = asleep.addEventListener(
      "onMicPermissionDenied",
      onMicPermissionDenied
    );

    const debugLogListener = asleep.addEventListener("onDebugLog", onDebugLog);

    const initSDK = async () => {
      try {
        const didInitSDK = await initAsleepConfig({
          apiKey: API_KEY,
        });
        addLog(`SDK initialized: ${didInitSDK}`);
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <View>
          <Text>User ID: {userId}</Text>
          <Text>Session ID: {sessionId}</Text>
          <Text>
            Tracking Status: {isTracking ? "Tracking" : "Not Tracking"}
          </Text>
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
          <Button
            title="Get Report"
            onPress={() => {
              if (!sessionId) {
                addLog("No session ID");
                return;
              }
              getReport(sessionId);
            }}
          />
          <Button
            title="Get Report List"
            onPress={() => {
              const today = moment();
              const fromDate = today.subtract(1, "month").format("YYYY-MM-DD");
              const toDate = today.format("YYYY-MM-DD");

              getReportList(fromDate, toDate);
            }}
          />
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
