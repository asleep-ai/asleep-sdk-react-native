import ExpoModulesCore
import AsleepSDK

public class AsleepModule: Module {
    private var trackingManager: Asleep.SleepTrackingManager?
    private var reportManager: Asleep.Reports?
    private(set) var config: Asleep.Config?
    private var isLogEnabled = false

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

        // JS validates that exactly one credential form is present: apiKey, or appId + appSecret,
        // and validates productInfo. A nil productInfo skips product registration.
        Function("setup") { (credentials: SetupCredentialsRecord, baseUrl: String?, callbackUrl: String?, service: String?, enableODA: Bool?, productInfo: ProductInfoRecord?) in
            var product: Asleep.ProductInfo?
            if let productInfo = productInfo {
                guard let identifierType = Asleep.ProductIdentifierType(rawValue: productInfo.identifierType) else {
                    throw Exception(name: "INVALID_ARGUMENT", description: "Unknown productInfo.identifierType: \(productInfo.identifierType)", code: "INVALID_ARGUMENT")
                }
                product = Asleep.ProductInfo(model: productInfo.model,
                                             identifierType: identifierType,
                                             identifierValue: productInfo.identifierValue)
            }
            Asleep.setLogger(self)
            if let appId = credentials.appId, let appSecret = credentials.appSecret {
                Asleep.setup(appId: appId,
                            appSecret: appSecret,
                            baseUrl: URL(string: baseUrl ?? ""),
                            callbackUrl: URL(string: callbackUrl ?? ""),
                            service: service,
                            enableODA: enableODA ?? false,
                            productInfo: product,
                            delegate: self)
            } else {
                Asleep.setup(apiKey: credentials.apiKey ?? "",
                            baseUrl: URL(string: baseUrl ?? ""),
                            callbackUrl: URL(string: callbackUrl ?? ""),
                            service: service,
                            enableODA: enableODA ?? false,
                            productInfo: product,
                            delegate: self)
            }
        }

        Function("initAsleepConfig") { (apiKey: String?, appId: String?, appSecret: String?, userId: String?, baseUrl: String?, callbackUrl: String?) in
            // Drop the previous user's config until userDidJoin delivers the new one,
            // so metadata and report calls never run as the previous user. The
            // tracking manager is left alone so a running session is not disturbed.
            self.config = nil
            self.reportManager = nil
            Asleep.setLogger(self)
            if let appId = appId, let appSecret = appSecret {
                Asleep.initAsleepConfig(appId: appId,
                                        appSecret: appSecret,
                                        userId: userId,
                                        baseUrl: URL(string: baseUrl ?? ""),
                                        callbackUrl: URL(string: callbackUrl ?? ""),
                                        delegate: self)
            } else {
                Asleep.initAsleepConfig(apiKey: apiKey,
                                        userId: userId,
                                        baseUrl: URL(string: baseUrl ?? ""),
                                        callbackUrl: URL(string: callbackUrl ?? ""),
                                        delegate: self)
            }
        }

        // Gates SDK log forwarding natively so disabled logs never cross the
        // bridge — every forwarded line lands in addLog, and `log` is returned
        // from useAsleep(), so unconditional forwarding re-renders consumers.
        Function("enableLog") { (enabled: Bool) in
            self.isLogEnabled = enabled
        }

        AsyncFunction("isSleepTrackingAlive") { () -> Bool in
            // iOS doesn't have a persistent foreground service like Android
            // Always return false to maintain consistent API behavior
            self.sendEvent("onDebugLog", ["message": "isSleepTrackingAlive: false (iOS)"])
            return false
        }

        AsyncFunction("connectSleepTracking") { () -> Bool in
            // iOS doesn't need to connect to an existing service
            // This is a stub method for API consistency with Android
            self.sendEvent("onDebugLog", ["message": "connectSleepTracking: no-op on iOS"])
            return false
        }

        AsyncFunction("startTracking") { (config: [String: Any]?) -> Void in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }

            var additionalOptions: AVAudioSession.CategoryOptions = []
            if let iosConfig = config?["ios"] as? [String: Any],
               let optionNames = iosConfig["audioSessionOptions"] as? [String] {
                for name in optionNames {
                    switch name {
                    case "duckOthers":
                        additionalOptions.insert(.duckOthers)
                    case "allowAirPlay":
                        additionalOptions.insert(.allowAirPlay)
                    case "allowBluetooth":
                        additionalOptions.insert(.allowBluetooth)
                    case "allowBluetoothA2DP":
                        additionalOptions.insert(.allowBluetoothA2DP)
                    default:
                        sendEvent("onDebugLog", ["message": "Unknown audio session option: \(name)"])
                    }
                }
            }

            trackingManager.startTracking(additionalAudioSessionOptions: additionalOptions)
        }

        // Range bounds are epoch milliseconds; JS validates start < end before calling.
        AsyncFunction("stopTracking") { (analysisStartMs: Double?, analysisEndMs: Double?) -> Void in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }
            if let analysisStartMs = analysisStartMs, let analysisEndMs = analysisEndMs {
                trackingManager.stopTracking(analysisStartTime: Date(timeIntervalSince1970: analysisStartMs / 1000),
                                             analysisEndTime: Date(timeIntervalSince1970: analysisEndMs / 1000))
            } else {
                trackingManager.stopTracking()
            }
        }

        AsyncFunction("resumeTracking") { () -> Void in
            guard let trackingManager = self.trackingManager else {
                throw NSError(domain: "AsleepModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tracking manager not initialized"])
            }
            trackingManager.resumeTracking()
        }

        AsyncFunction("getReport") { (sessionId: String) -> [String: Any] in
            sendEvent("onDebugLog", ["message": "getReport"])

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

        AsyncFunction("getAverageReport") { (fromDate: String, toDate: String) -> [String: Any] in
            sendEvent("onDebugLog", ["message": "getAverageReport"])

            guard let reportManager = self.reportManager else {
                sendEvent("onDebugLog", ["message": "Reports not initialized"])
                throw NSError(domain: "AsleepModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Reports not initialized"])
            }
            do {
                let averageReport = try await reportManager.getAverageReport(fromDate: fromDate, toDate: toDate)
                sendEvent("onDebugLog", ["message": "averageReport: \(averageReport)"])

                return try averageReport.asDictionary()
            } catch {
                sendEvent("onDebugLog", ["message": "Error getting average report: \(error)"])
                throw error
            }
        }

        // Resolves when the server accepts the request; the completion block is
        // not called on the main queue (Reports.Interface.swift). Range bounds are
        // epoch milliseconds and are always passed explicitly (null when absent).
        AsyncFunction("reanalyze") { (sessionId: String, analysisStartMs: Double?, analysisEndMs: Double?, promise: Promise) in
            guard let reportManager = self.reportManager else {
                promise.reject("MISSING_PREREQUISITE", "Reports not initialized")
                return
            }
            let completion: (String?, Asleep.AsleepError?) -> Void = { _, error in
                if let error = error {
                    let sdkCode = error.errorCode.code
                    // 11009 invalidParameter: start >= end (JS validates this first).
                    let code = sdkCode == 11009 ? "INVALID_ARGUMENT" : "REANALYZE_FAILED"
                    promise.reject(sdkRejection(code, sdkCode: sdkCode, message: sdkMessage(error)))
                } else {
                    promise.resolve(nil)
                }
            }
            if let analysisStartMs = analysisStartMs, let analysisEndMs = analysisEndMs {
                reportManager.reanalyze(sessionId: sessionId,
                                        analysisStartTime: Date(timeIntervalSince1970: analysisStartMs / 1000),
                                        analysisEndTime: Date(timeIntervalSince1970: analysisEndMs / 1000),
                                        completionBlock: completion)
            } else {
                reportManager.reanalyze(sessionId: sessionId, completionBlock: completion)
            }
        }

        // Promise style (not a throwing AsyncFunction) so rejections carry the SDK message
        // as-is instead of Expo's "Calling the '...' function has failed" wrapper,
        // matching reanalyze and Android.
        AsyncFunction("saveUserMetadata") { (metadata: UserMetadataRecord, promise: Promise) in
            Task {
                do {
                    try await self.saveUserMetadata(metadata)
                    promise.resolve(nil)
                } catch let exception as Exception {
                    promise.reject(exception)
                } catch {
                    promise.reject(sdkRejection("SAVE_USER_METADATA_FAILED", sdkCode: 27000, message: error.localizedDescription))
                }
            }
        }

        AsyncFunction("fetchUserMetadata") { (promise: Promise) in
            Task {
                do {
                    promise.resolve(try await self.fetchUserMetadata())
                } catch let exception as Exception {
                    promise.reject(exception)
                } catch {
                    promise.reject(sdkRejection("FETCH_USER_METADATA_FAILED", sdkCode: 27100, message: error.localizedDescription))
                }
            }
        }

        Function("isTracking") { () -> Bool in
            return trackingManager?.getTrackingStatus().sessionId != nil
        }

        AsyncFunction("hasRequiredPermissions") { () -> Bool in
            return AVAudioSession.sharedInstance().recordPermission == .granted
        }

        // Deprecated method for backward compatibility
        AsyncFunction("requestMicrophonePermission") { () -> Bool in
            let audioSession = AVAudioSession.sharedInstance()
            var permissionGranted = false
            let semaphore = DispatchSemaphore(value: 0)

            audioSession.requestRecordPermission { granted in
                permissionGranted = granted
                semaphore.signal()
            }

            semaphore.wait()
            return permissionGranted
        }

        AsyncFunction("requestRequiredPermissions") { () -> Bool in
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

        // Battery optimization stub - not applicable on iOS
        Function("isBatteryOptimizationExempted") { () -> Bool in
            // iOS doesn't have battery optimization like Android
            return true
        }

        AsyncFunction("requestBatteryOptimizationExemption") { (promise: Promise) in
            // Not applicable on iOS
            promise.resolve(true)
        }
    }
}

// Expo rejections carry only a code string and a message. JS normalizeError
// splits "<CODE>:<sdkCode>" back into AsleepError.code and AsleepError.sdkCode.
// AsleepError is not a LocalizedError, so localizedDescription is only the generic
// "The operation couldn't be completed" text. Prefer the SDK/server message.
private func sdkMessage(_ error: Asleep.AsleepError) -> String {
    if let message = error.errorCode.message, !message.isEmpty { return message }
    return String(describing: error)
}

private func sdkRejection(_ code: String, sdkCode: Int, message: String) -> Exception {
    let encoded = "\(code):\(sdkCode)"
    return Exception(name: encoded, description: message, code: encoded)
}

struct SetupCredentialsRecord: Record {
    @Field var apiKey: String?
    @Field var appId: String?
    @Field var appSecret: String?
}

struct ProductInfoRecord: Record {
    @Field var model: String = ""
    @Field var identifierType: String = ""
    @Field var identifierValue: String = ""
}

struct UserMetadataRecord: Record {
    @Field var birthYear: Int?
    @Field var birthMonth: Int?
    @Field var birthDay: Int?
    @Field var gender: String?
    @Field var height: Double?
    @Field var weight: Double?
}

extension AsleepModule: AsleepSetupDelegate {
    public func setupDidComplete() {
        sendEvent("onSetupDidComplete", [:])
    }

    public func setupDidFail(error: Asleep.AsleepError) {
        sendEvent("onSetupDidFail", [
            "error": error.localizedDescription,
            "caseName": String(describing: error),
            "code": (error as NSError).code,
            "sdkCode": error.errorCode.code
        ])
    }

    public func setupInProgress(progress: Int) {
        sendEvent("onSetupInProgress", ["progress": progress])
    }
    private func saveUserMetadata(_ metadata: UserMetadataRecord) async throws {
        guard let config = self.config else {
            throw Exception(name: "MISSING_PREREQUISITE", description: "AsleepConfig is not initialized", code: "MISSING_PREREQUISITE")
        }
        var gender: Asleep.Model.Gender?
        if let rawGender = metadata.gender {
            guard let parsed = Asleep.Model.Gender(rawValue: rawGender) else {
                throw sdkRejection("INVALID_ARGUMENT", sdkCode: 27400, message: "Unknown gender: \(rawGender)")
            }
            gender = parsed
        }
        let model = Asleep.Model.UserMetadata(birthYear: metadata.birthYear,
                                              birthMonth: metadata.birthMonth,
                                              birthDay: metadata.birthDay,
                                              gender: gender,
                                              height: metadata.height,
                                              weight: metadata.weight)
        do {
            try await Asleep.saveUserMetadata(model, config: config)
        } catch let error as Asleep.AsleepError {
            let sdkCode = error.errorCode.code
            throw sdkRejection(sdkCode == 27400 ? "INVALID_ARGUMENT" : "SAVE_USER_METADATA_FAILED", sdkCode: sdkCode, message: sdkMessage(error))
        } catch {
            // Non-SDK failures (e.g. URLError) map to ERR_SAVE_METADATA_FAILED.
            throw sdkRejection("SAVE_USER_METADATA_FAILED", sdkCode: 27000, message: error.localizedDescription)
        }
    }

    private func fetchUserMetadata() async throws -> [String: Any]? {
        guard let config = self.config else {
            throw Exception(name: "MISSING_PREREQUISITE", description: "AsleepConfig is not initialized", code: "MISSING_PREREQUISITE")
        }
        let metadata: Asleep.Model.UserMetadata?
        do {
            metadata = try await Asleep.fetchUserMetadata(config: config)
        } catch let error as Asleep.AsleepError {
            throw sdkRejection("FETCH_USER_METADATA_FAILED", sdkCode: error.errorCode.code, message: sdkMessage(error))
        } catch {
            // Non-SDK failures (e.g. URLError) map to ERR_FETCH_METADATA_FAILED.
            throw sdkRejection("FETCH_USER_METADATA_FAILED", sdkCode: 27100, message: error.localizedDescription)
        }
        return try metadata?.asDictionary()
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
        self.config = nil
        self.reportManager = nil
        sendEvent("onUserJoinFailed", [
            "error": error.localizedDescription,
            "caseName": String(describing: error),
            "code": (error as NSError).code,
            "sdkCode": error.errorCode.code
        ])
    }

    public func userDidDelete(userId: String) {
        sendEvent("onUserDeleted", ["userId": userId])
    }
}

extension AsleepModule: AsleepSleepTrackingManagerDelegate {
    public func didFail(error: Asleep.AsleepError) {
        sendEvent("onDebugLog", ["message": "Tracking failed: \(error)"])

        var errorInfo: [String: Any] = ["error": error.localizedDescription]

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
        case .uploadTrackingTerminated(let msg):
            errorInfo["code"] = "UPLOAD_TRACKING_TERMINATED"
            errorInfo["message"] = msg
        case .interruptionRecoveryFailed(let attemptsCount):
            errorInfo["code"] = "INTERRUPTION_RECOVERY_FAILED"
            errorInfo["message"] = "Failed to recover from audio interruption after \(attemptsCount) attempts"
            errorInfo["attemptsCount"] = attemptsCount
        case .audioInitializationFailed:
            errorInfo["code"] = "AUDIO_INITIALIZATION_FAILED"
            errorInfo["message"] = "Audio recording could not be initialized and the recording engine has been torn down. resumeTracking() will not help; the session must be stopped and restarted."
        case .cannotActivateInBackground:
            errorInfo["code"] = "CANNOT_ACTIVATE_IN_BACKGROUND"
            errorInfo["message"] = "Recording could not resume in background. The SDK retries when the app becomes active; call resumeTracking() in foreground if uploads do not resume."
        default:
            errorInfo["code"] = "UNKNOWN_ERROR"
            errorInfo["caseName"] = String(describing: error)
        }
        // (error as NSError).code is the Swift enum declaration ordinal, not the
        // documented Asleep error code; kept for backward compatibility only.
        // It shifts when the SDK adds enum cases (3.3.x moved 38/39 to 59/60).
        errorInfo["errorCode"] = (error as NSError).code
        // Documented numeric code (10000-34999) via the SDK's errorCode computed
        // property — the v3.2.0+ recommended API (Asleep.Interface.swift). This is
        // what JS uses to classify errors, including cases in the default: arm.
        errorInfo["sdkCode"] = error.errorCode.code

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

// AsleepDebugLoggerDelegate is deprecated in 3.2.0 and removed in 3.3.0.
extension AsleepModule: AsleepLogger {
    private func sendLoggerEvent(level: String, tag: LogTag, msg: String, error: Error?) {
        var message = "[\(level)][\(tag.value)] \(msg)"
        if let error = error {
            message += " | \(error.localizedDescription)"
        }
        sendEvent("onDebugLog", ["message": message])
    }

    public func d(tag: LogTag, msg: String, error: Error?) {
        guard isLogEnabled else { return }
        sendLoggerEvent(level: "D", tag: tag, msg: msg, error: error)
    }

    public func e(tag: LogTag, msg: String, error: Error?) {
        guard isLogEnabled else { return }
        sendLoggerEvent(level: "E", tag: tag, msg: msg, error: error)
    }

    public func i(tag: LogTag, msg: String, error: Error?) {
        guard isLogEnabled else { return }
        sendLoggerEvent(level: "I", tag: tag, msg: msg, error: error)
    }

    public func w(tag: LogTag, msg: String, error: Error?) {
        guard isLogEnabled else { return }
        sendLoggerEvent(level: "W", tag: tag, msg: msg, error: error)
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
