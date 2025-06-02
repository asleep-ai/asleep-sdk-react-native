import moment from "moment";
import React, { useEffect, useState } from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
} from "react-native";
import { useAsleep } from "../src";

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState<any>(null);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [originalReportList, setOriginalReportList] = useState<any[]>([]);

  const {
    userId,
    sessionId,
    error,
    log,
    isTracking,
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

  const showModal = (title: string, content: any) => {
    setModalTitle(title);
    setModalContent(content);
    setSelectedReport(null);

    // If showing report list, save the original list
    if (title === "Report List") {
      setOriginalReportList(Array.isArray(content) ? content : []);
    }

    setModalVisible(true);
  };

  const showReportDetail = (report: any) => {
    setSelectedReport(report);
    setModalTitle("Sleep Report Details");
    setModalContent(report);
  };

  const goBackToReportList = () => {
    setSelectedReport(null);
    setModalTitle("Report List");
    setModalContent(originalReportList);
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
        // Show report in modal
        showModal("Sleep Report", report);
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
      addLog(
        `Retrieved ${
          Array.isArray(reportList) ? reportList.length : "unknown"
        } reports`
      );

      // Ensure reportList is an array
      const normalizedReportList = Array.isArray(reportList) ? reportList : [];

      // Show report list in modal
      showModal("Report List", normalizedReportList);
    } catch (error: any) {
      addLog(`Get report list error: ${error.message}`);
    }
  };

  const renderModalContent = () => {
    if (!modalContent) return null;

    // Show individual report details
    if (modalTitle === "Sleep Report" || selectedReport) {
      const report = selectedReport || modalContent;
      return (
        <View>
          {selectedReport && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={goBackToReportList}
            >
              <Text style={styles.backButtonText}>← Back to List</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.modalSectionTitle}>Basic Information</Text>
          <Text>Session ID: {report.sessionId || "N/A"}</Text>
          <Text>User ID: {report.userId || "N/A"}</Text>
          <Text>
            Date: {report.createdAt || report.sessionStartTime || "N/A"}
          </Text>
          <Text>State: {report.state || "N/A"}</Text>
          <Text>
            Time in Bed:{" "}
            {report.timeInBed ? `${report.timeInBed} minutes` : "N/A"}
          </Text>

          {report.stat && (
            <>
              <Text style={styles.modalSectionTitle}>Sleep Statistics</Text>
              <Text>Sleep Index: {report.stat.sleepIndex || "N/A"}</Text>
              <Text>
                Sleep Time:{" "}
                {report.stat.sleepTime
                  ? `${Math.round(report.stat.sleepTime / 60)} minutes`
                  : "N/A"}
              </Text>
              <Text>
                Wake Time:{" "}
                {report.stat.wakeTime
                  ? `${Math.round(report.stat.wakeTime / 60)} minutes`
                  : "N/A"}
              </Text>
              <Text>
                Sleep Latency:{" "}
                {report.stat.sleepLatency
                  ? `${Math.round(report.stat.sleepLatency / 60)} minutes`
                  : "N/A"}
              </Text>
              <Text>
                Sleep Efficiency:{" "}
                {report.stat.sleepEfficiency
                  ? `${Math.round(report.stat.sleepEfficiency * 100)}%`
                  : "N/A"}
              </Text>
            </>
          )}

          {report.timeSeries && report.timeSeries.length > 0 && (
            <>
              <Text style={styles.modalSectionTitle}>Time Series Data</Text>
              <Text>Total {report.timeSeries.length} data points</Text>
            </>
          )}
        </View>
      );
    } else if (modalTitle === "Report List" && !selectedReport) {
      // Show report list - ensure modalContent is an array
      const reportList = Array.isArray(modalContent) ? modalContent : [];

      if (reportList.length === 0) {
        return (
          <View>
            <Text style={styles.modalSectionTitle}>No Reports Found</Text>
            <Text>
              There are no sleep reports available for the selected time period.
            </Text>
          </View>
        );
      }

      return (
        <View>
          <Text style={styles.modalSectionTitle}>
            Total {reportList.length} Reports
          </Text>
          {reportList.map((report: any, index: number) => (
            <TouchableOpacity
              key={report.sessionId || index}
              style={styles.reportItem}
              onPress={() => showReportDetail(report)}
            >
              <Text style={styles.reportItemTitle}>Report #{index + 1}</Text>
              <Text>Session ID: {report.sessionId || "N/A"}</Text>
              <Text>
                Date: {report.createdAt || report.sessionStartTime || "N/A"}
              </Text>
              <Text>State: {report.state || "N/A"}</Text>
              {report.timeInBed && (
                <Text>Time in Bed: {report.timeInBed} minutes</Text>
              )}
              {report.stat?.sleepIndex && (
                <Text>Sleep Index: {report.stat.sleepIndex}</Text>
              )}
              <Text style={styles.tapHint}>Tap to view details →</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    return <Text>{JSON.stringify(modalContent, null, 2)}</Text>;
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

        {/* Modal Component */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{modalTitle}</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.modalContent}>
                {renderModalContent()}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
    marginBottom: 20,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 10,
    padding: 0,
    margin: 20,
    maxHeight: "80%",
    minWidth: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    fontSize: 20,
    color: "#666",
  },
  modalContent: {
    padding: 20,
    maxHeight: 400,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    color: "#333",
  },
  reportItem: {
    backgroundColor: "#f5f5f5",
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  reportItemTitle: {
    fontWeight: "bold",
    marginBottom: 5,
    fontSize: 16,
  },
  tapHint: {
    color: "#007AFF",
    fontSize: 12,
    marginTop: 5,
    fontStyle: "italic",
  },
  backButton: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 5,
  },
  backButtonText: {
    color: "#007AFF",
    fontSize: 14,
  },
});

export default App;
