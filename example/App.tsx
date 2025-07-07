import moment from "moment";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
} from "react-native";
import { useTracking } from "./useTracking";
import { useAsleep } from "react-native-asleep/src";

const SHOW_DEBUG_LOG = true;

const App = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState<any>(null);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [originalReportList, setOriginalReportList] = useState<any[]>([]);
  const [trackingDuration, setTrackingDuration] = useState<number>(0);

  const {
    userId,
    sessionId,
    error,
    log,
    isTracking,
    isODAEnabled,
    analysisResult,
    isAnalyzing,
    startTracking,
    stopTracking,
    getReport,
    getReportList,
    requestAnalysis,
    enableLog,
    isTrackingPaused,
    getTrackingDurationMinutes,
    isInitialized,
  } = useTracking();

  const { didClose, deleteSession } = useAsleep();

  // useTracking hook에서 로그 처리
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

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTracking && !isTrackingPaused) {
      interval = setInterval(async () => {
        try {
          const duration = await getTrackingDurationMinutes();
          setTrackingDuration(duration);
        } catch (error) {
          console.error("Failed to get tracking duration:", error);
        }
      }, 1000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isTracking, isTrackingPaused, getTrackingDurationMinutes]);

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
        `Retrieved ${Array.isArray(reportList) ? reportList.length : "unknown"
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

  const _requestAnalysis = async () => {
    try {
      const result = await requestAnalysis();
      if (result) {
        addLog(`Analysis result: ${JSON.stringify(result)}`);
        showModal("Analysis Result", result);
      } else {
        addLog("No analysis result available");
      }
    } catch (error: any) {
      addLog(`Analysis error: ${error.message}`);
    }
  };

  const _deleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      addLog(`Session deleted: ${sessionId}`);
      Alert.alert("Success", "Session deleted successfully");
      setModalVisible(false);
      // Refresh the report list after deletion
      _getReportList();
    } catch (error: any) {
      addLog(`Delete session error: ${error.message}`);
      Alert.alert("Error", `Failed to delete session: ${error.message}`);
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

          {/* Delete button */}
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => {
              Alert.alert(
                "Delete Session",
                `Are you sure you want to delete session ${report.sessionId}?`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => _deleteSession(report.sessionId)
                  },
                ]
              );
            }}
          >
            <Text style={styles.deleteButtonText}>Delete Session</Text>
          </TouchableOpacity>
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
    } else if (modalTitle === "Analysis Result") {
      // Show analysis result (Session data)
      const session = modalContent;
      return (
        <View>
          <Text style={styles.modalSectionTitle}>
            Real-time Analysis Result
          </Text>
          <Text>Session ID: {session.id ?? "N/A"}</Text>
          <Text>State: {session.state ?? "N/A"}</Text>
          <Text>Start Time: {session.startTime ?? "N/A"}</Text>
          <Text>End Time: {session.endTime ?? "N/A"}</Text>
          <Text>
            Sleep Stages: {session.sleepStages?.length || 0} data points
          </Text>
          <Text>
            Snoring Stages: {session.snoringStages?.length || 0} data points
          </Text>

          {session.sleepStages && session.sleepStages.length > 0 && (
            <>
              <Text style={styles.modalSectionTitle}>
                Sleep Stages (Recent 10)
              </Text>
              <Text>{session.sleepStages.slice(-10).join(", ")}</Text>
            </>
          )}

          {session.snoringStages && session.snoringStages.length > 0 && (
            <>
              <Text style={styles.modalSectionTitle}>
                Snoring Stages (Recent 10)
              </Text>
              <Text>{session.snoringStages.slice(-10).join(", ")}</Text>
            </>
          )}
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
          <Text>SDK Initialized: {isInitialized ? "Yes" : "No"}</Text>
          <Text>
            Tracking Status:{" "}
            {!isTracking
              ? "Not Tracking"
              : isTrackingPaused
                ? "Paused"
                : "Active"}
          </Text>
          <Text>ODA Enabled: {isODAEnabled ? "Yes" : "No"}</Text>
          <Text>Analysis Status: {isAnalyzing ? "Yes" : "No"}</Text>
          {isTracking && (
            <Text>
              Tracking Duration: {Math.floor(trackingDuration)} minutes
            </Text>
          )}
          {analysisResult && (
            <Text style={styles.analysisResult}>
              Latest Analysis: Session ID: {analysisResult.id}, State:{" "}
              {analysisResult.state}, Sleep Stages:{" "}
              {analysisResult.sleepStages?.join(", ") || "[]"}, Breath Stages:{" "}
              {analysisResult.breathStages?.join(", ") || "[]"}
              Snoring Stages: {analysisResult.snoringStages?.join(", ") || "[]"}
              ,
            </Text>
          )}
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
            disabled={!isInitialized || isTracking}
            onPress={_startTracking}
          />
          <Button
            title="Stop Tracking"
            disabled={!isTracking}
            onPress={_stopTracking}
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button title="Get Report" onPress={_getReport} />
          <Button title="Get Report List" onPress={_getReportList} />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title={isAnalyzing ? "Analyzing..." : "Request Analysis"}
            onPress={_requestAnalysis}
            disabled={isAnalyzing || !isTracking || isTrackingPaused}
          />
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
    backgroundColor: "white",
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
  analysisResult: {
    color: "blue",
    fontSize: 12,
    marginTop: 5,
    fontWeight: "bold",
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
  deleteButton: {
    marginTop: 20,
    backgroundColor: "#ff3b30",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
});

export default App;
