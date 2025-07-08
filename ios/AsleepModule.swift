import ExpoModulesCore
import AsleepSDK

public class AsleepModule: Module {
    private var trackingManager: Asleep.SleepTrackingManager?
    private var reportManager: Asleep.Reports?
    private(set) var config: Asleep.Config?
    
    public func definition() -> ModuleDefinition {
        Name("Asleep")

        Events("onTrackingCreated")
        Events("onTrackingUploaded") 
        Events("onTrackingClosed")  
        Events("onTrackingFailed")  
        Events("onTrackingInterrupted")
        Events("onTrackingResumed")
        Events("onMicPermissionDenied")
        Events("onUserJoined")  
        Events("onUserJoinFailed") 
        Events("onUserDeleted")
        
        Events("onDebugLog")
        Events("onSetupDidComplete")
        Events("onSetupDidFail")
        Events("onSetupInProgress")
        Events("onAnalysisResult")

        Function("setup") { (apiKey: String, baseUrl: String?, callbackUrl: String?, service: String?, enableODA: Bool?) in
            Asleep.setup(apiKey: apiKey,
                        baseUrl: URL(string: baseUrl ?? ""),
                        callbackUrl: URL(string: callbackUrl ?? ""),
                        service: service,
                        enableODA: enableODA ?? false,
                        delegate: self)
        }

        Function("initAsleepConfig") { (apiKey: String, userId: String?, baseUrl: String?, callbackUrl: String?) in
            Asleep.initAsleepConfig(apiKey: apiKey,
                                    userId: userId,
                                    baseUrl: URL(string: baseUrl ?? ""),
                                    callbackUrl: URL(string: callbackUrl ?? ""),
                                    delegate: self)
        }

        AsyncFunction("startTracking") { () -> Void in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }
            trackingManager.startTracking()
        }

        AsyncFunction("stopTracking") { () -> Void in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }
            trackingManager.stopTracking()
        }

        AsyncFunction("getReport") { (sessionId: String) -> [String: Any] in
            sendEvent("onDebugLog", ["message": "getReport"])
 
            guard let config = self.config else {
                sendEvent("onDebugLog", ["message": "Config not initialized"])
                throw NSError(domain: "AsleepModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Config not initialized"])

            }
            reportManager = Asleep.createReports(config: config)

            guard let reportManager = self.reportManager else {
                sendEvent("onDebugLog", ["message": "Reports not initialized"])
                throw NSError(domain: "AsleepModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Reports not initialized"])
            }
            do {
                let report = try await reportManager.report(sessionId: sessionId)
                sendEvent("onDebugLog", ["message": "report: \(report)"])
                 
                return try report.asDictionary()
            } catch {
                sendEvent("onDebugLog", ["message": "Error getting report: \(error)"])
                throw error
            }
        }

        AsyncFunction("getReportList") { (fromDate: String, toDate: String) -> [[String: Any]] in
            guard let reportManager = self.reportManager else {
                throw NSError(domain: "AsleepModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Reports not initialized"])
            }
            let reportList = try await reportManager.reports(fromDate: fromDate, toDate: toDate, limit: 100)
            sendEvent("onDebugLog", ["message": "reportList: \(reportList)"])
            let dictionary: [[String: Any]] = reportList.map { $0.toDictionary() }
            return dictionary
        }

        AsyncFunction("deleteSession") { (sessionId: String) -> Void in
            guard let reportManager = self.reportManager else {
                throw NSError(domain: "AsleepModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Reports not initialized"])
            }
            sendEvent("onDebugLog", ["message": "deleteSession: \(sessionId)"])
            try await reportManager.deleteReport(sessionId: sessionId)
            sendEvent("onDebugLog", ["message": "deleteSession completed"])
        }

        Function("isTracking") { () -> Bool in
            return trackingManager?.getTrackingStatus().sessionId != nil
        }

        AsyncFunction("requestMicrophonePermission") { () -> Bool in
            let audioSession = AVAudioSession.sharedInstance()
            var permissionGranted = false
            let semaphore = DispatchSemaphore(value: 0)
            audioSession.requestRecordPermission { granted in
                permissionGranted = granted
                if granted {
                    self.sendEvent("onDebugLog", ["message": "Microphone permission granted"])
                } else {
                    self.sendEvent("onDebugLog", ["message": "Microphone permission denied"])
                }
                semaphore.signal()
            }
            semaphore.wait()
            return permissionGranted
        }

        AsyncFunction("requestAnalysis") { () -> [String: Any]? in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }
            
            trackingManager.requestAnalysis()
            let ackData: [String: Any] = [
                "status": "requested",
                "timestamp": Date().timeIntervalSince1970 * 1000
            ]
            return ackData
        }
    }
}

extension AsleepModule: AsleepSetupDelegate {
    public func setupDidComplete() {
        sendEvent("onSetupDidComplete", [:])
    }
    
    public func setupDidFail(error: Asleep.AsleepError) {
        sendEvent("onSetupDidFail", ["error": error.localizedDescription])
    }
    
    public func setupInProgress(progress: Int) {
        sendEvent("onSetupInProgress", ["progress": progress])
    }
}

extension AsleepModule: AsleepConfigDelegate {
    public func userDidJoin(userId: String, config: Asleep.Config) {
        self.config = config
        self.trackingManager = Asleep.createSleepTrackingManager(config: config, delegate: self)
        self.reportManager = Asleep.createReports(config: config)
        sendEvent("onUserJoined", ["userId": userId])
    }

    public func didFailUserJoin(error: Asleep.AsleepError) {
        sendEvent("onUserJoinFailed", ["error": error.localizedDescription])
    }

    public func userDidDelete(userId: String) {
        sendEvent("onUserDeleted", ["userId": userId])
    }
}

extension AsleepModule: AsleepSleepTrackingManagerDelegate {
    public func didFail(error: Asleep.AsleepError) {
        sendEvent("onDebugLog", ["message": "Tracking failed: \(error)"])
        
        var errorInfo: [String: Any] = ["error": error.localizedDescription]
        
        // Add specific error codes for new v3.1.4 error cases
        switch error {
        case .ODAIntegrityFail:
            errorInfo["code"] = "ODA_INTEGRITY_FAIL"
            errorInfo["message"] = "The model has been updated or the file is corrupted"
        case .networkOffline:
            errorInfo["code"] = "NETWORK_OFFLINE"
            errorInfo["message"] = "The Internet connection appears to be offline"
        case .unableODA:
            errorInfo["code"] = "UNABLE_ODA"
            errorInfo["message"] = "On-device analysis is not available"
        default:
            errorInfo["code"] = "UNKNOWN_ERROR"
        }
        
        sendEvent("onTrackingFailed", errorInfo)
    }

    public func didCreate() {
        attemptGetSessionId(retriesLeft: 5, retryInterval: 1.0)
    }
    
    private func attemptGetSessionId(retriesLeft: Int, retryInterval: TimeInterval) {
        if let sessionId = trackingManager?.getTrackingStatus().sessionId {
            sendEvent("onTrackingCreated", ["sessionId": sessionId])
            return
        }
        
        if retriesLeft > 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + retryInterval) { [weak self] in
                self?.attemptGetSessionId(retriesLeft: retriesLeft - 1, retryInterval: retryInterval)
            }
        } else {
            sendEvent("onTrackingCreated", [:])
        }
    }

    public func didUpload(sequence: Int) {
        sendEvent("onTrackingUploaded", ["sequence": sequence])
    }

    public func didClose(sessionId: String) {
        sendEvent("onTrackingClosed", ["sessionId": sessionId])
    }

    public func didInterrupt() {
        sendEvent("onTrackingInterrupted", [:])
    }

    public func didResume() {
        sendEvent("onTrackingResumed", [:])
    }

    public func micPermissionWasDenied() {
        sendEvent("onMicPermissionDenied", [:])
    }
    
    public func analysing(session: Asleep.Model.Session) {
        sendEvent("onDebugLog", ["message": "Analysing session: \(session)"])
        
        // Convert session to dictionary and send as analysis result
        do {
            let sessionData = try session.asDictionary()
            sendEvent("onAnalysisResult", sessionData)
        } catch {
            sendEvent("onDebugLog", ["message": "Failed to convert session to dictionary: \(error)"])
        }
    }
}

extension AsleepModule: AsleepDebugLoggerDelegate {
    public func didPrint(message: String) {
        sendEvent("onDebugLog", ["message": message])
    }
}

extension Encodable {
  func asDictionary() throws -> [String: Any] {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(self)
    guard let dictionary = try JSONSerialization.jsonObject(with: data, options: .allowFragments) as? [String: Any] else {
      throw NSError()
    }
    return dictionary
  }
}

extension Asleep.Model.SleepSession {
    func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "sessionId": sessionId,
            "state": state.rawValue,
            "sessionStartTime": ISO8601DateFormatter().string(from: sessionStartTime),
            "createdTimezone": createdTimezone
        ]
        
        if let sessionEndTime = sessionEndTime {
            dict["sessionEndTime"] = ISO8601DateFormatter().string(from: sessionEndTime)
        }
        
        if let unexpectedEndTime = unexpectedEndTime {
            dict["unexpectedEndTime"] = ISO8601DateFormatter().string(from: unexpectedEndTime)
        }
        
        if let lastReceivedSeqNum = lastReceivedSeqNum {
            dict["lastReceivedSeqNum"] = lastReceivedSeqNum
        }
        
        if let timeInBed = timeInBed {
            dict["timeInBed"] = timeInBed
        }
        
        return dict
    }
}
