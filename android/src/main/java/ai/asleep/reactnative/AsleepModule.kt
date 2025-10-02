package ai.asleep.reactnative

import ai.asleep.asleepsdk.Asleep
import ai.asleep.asleepsdk.data.AsleepConfig
import ai.asleep.asleepsdk.data.Report
import ai.asleep.asleepsdk.data.SleepSession
import ai.asleep.asleepsdk.tracking.Reports
import ai.asleep.asleepsdk.tracking.SleepTrackingManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.app.Application
import kotlinx.coroutines.*
import kotlinx.coroutines.delay
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import android.os.DeadObjectException
import android.util.Log
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri

class AsleepModule : Module() {
    private val gson = Gson()
    
    private var _asleepConfig: AsleepConfig? = null
    
    private var _sessionId = MutableLiveData<String?>(null)
    val sessionId: LiveData<String?> get() = _sessionId

    private var _sequence = MutableLiveData<Int?>(null)
    val sequence: LiveData<Int?> get() = _sequence

    private var _reportManager: Reports? = null
    
    // Added variables to replace PreferenceHelper
    private var isTracking = false
    private var savedApiKey: String? = null
    private var savedUserId: String? = null

    val trackingState: LiveData<TrackingState> get() = _trackingState
    private var _trackingState = MutableLiveData(TrackingState.STATE_TRACKING_STOPPED)
    enum class TrackingState { STATE_TRACKING_STOPPED, STATE_TRACKING_STARTING, STATE_TRACKING_STARTED, STATE_TRACKING_STOPPING}

    companion object {
        public const val MICROPHONE_PERMISSION_REQUEST_CODE = 1001
    }
 

    override fun definition() = ModuleDefinition {
        Name("Asleep")

        Events("onTrackingCreated", "onTrackingUploaded", "onTrackingClosed", "onTrackingFailed", 
               "onTrackingInterrupted", "onTrackingResumed", "onMicPermissionDenied",
               "onUserJoined", "onUserJoinFailed", "onUserDeleted", "onDebugLog",
               "onSetupDidComplete", "onSetupDidFail", "onSetupInProgress", "onAnalysisResult")

        AsyncFunction("setup") { apiKey: String, baseUrl: String?, callbackUrl: String?, service: String?, enableODA: Boolean?, promise: Promise ->
            try {
                val context = appContext.reactContext!!.applicationContext as Application
                
                Asleep.setup(
                    context = context,
                    apiKey = apiKey,
                    baseUrl = baseUrl,
                    callbackUrl = callbackUrl,
                    service = service ?: "SleepTracking",
                    enableODA = enableODA,
                    asleepSetupListener = object : Asleep.AsleepSetupListener {
                        override fun onComplete() {
                            sendEvent("onSetupDidComplete", emptyMap<String, Any>())
                            promise.resolve("Setup completed")
                        }
                        
                        override fun onProgress(progress: Int) {
                            sendEvent("onSetupInProgress", mapOf("progress" to progress))
                            sendEvent("onDebugLog", mapOf("message" to "Setup progress: $progress%"))
                        }
                        
                        override fun onFail(errorCode: Int, detail: String) {
                            sendEvent("onSetupDidFail", mapOf("error" to detail))
                            sendEvent("onDebugLog", mapOf("message" to "Setup failed: $errorCode - $detail"))
                            promise.reject("SETUP_FAILED", "Setup failed: $errorCode - $detail", null)
                        }
                    }
                )
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Setup failed: ${e.message}"))
                promise.reject("UNEXPECTED_ERROR", "Setup failed: ${e.message}", e)
            }
        }

        AsyncFunction("initAsleepConfig") { apiKey: String, userId: String?, baseUrl: String?, callbackUrl: String?, promise: Promise ->
            try {
                val context = appContext.reactContext!!.applicationContext as Application
                
                if (isTracking && savedApiKey == apiKey && savedUserId == userId) {
                    promise.resolve(mapOf("userId" to (savedUserId ?: "")))
                    sendEvent("onDebugLog", mapOf("message" to "Service reconnected"))
                    return@AsyncFunction
                }

                // Store API key in memory instead of preferences
                savedApiKey = apiKey

                Asleep.initAsleepConfig(
                    context = context,
                    apiKey = apiKey,
                    userId = userId,
                    baseUrl = baseUrl,
                    callbackUrl = callbackUrl,
                    service = "SleepTracking",
                    object : Asleep.AsleepConfigListener {
                        override fun onSuccess(userId: String?, asleepConfig: AsleepConfig?) {
                            if (userId != null) {
                                sendEvent("onDebugLog", mapOf("message" to "UserId is not null"))
                                // Store userId in memory instead of preferences
                                savedUserId = userId
                                sendEvent("onUserJoined", mapOf("userId" to userId))
                            }
                            _asleepConfig = asleepConfig

                            if (_asleepConfig != null) { 
                                sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is not null"))
                                _reportManager = Asleep.createReports(_asleepConfig)
                            } else {
                                sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is null"))
                                promise.reject("CONFIG_ERROR", "AsleepConfig is null", null)
                                return
                            }

                            sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is not null"))

                            // Return userId in the response instead of just a success message
                            promise.resolve(mapOf("userId" to (userId ?: "")))
                            try {
                                sendEvent("onDebugLog", mapOf("message" to "Initialization successful with userId: $userId"))
                            } catch (e: Exception) {
                                sendEvent("onDebugLog", mapOf("message" to "Error sending debug log: ${e.message}"))
                                println("Error sending debug log: ${e.message}")
                            }
                        }

                        override fun onFail(errorCode: Int, detail: String) {
                            sendEvent("onDebugLog", mapOf("message" to "Initialization failed: $errorCode - $detail"))
                            sendEvent("onUserJoinFailed", mapOf("errorCode" to errorCode, "detail" to detail))
                            promise.reject("INITIALIZATION_FAILED", "Initialization failed: $errorCode - $detail", null)
                        }
                    }
                )
                
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Initialization failed: ${e.message}"))
                promise.reject("UNEXPECTED_ERROR", "Initialization failed: ${e.message}", e)
            }
        }
        
        AsyncFunction("isSleepTrackingAlive") { promise: Promise ->
            try {
                val context = appContext.reactContext!!.applicationContext
                val isAlive = Asleep.isSleepTrackingAlive(context)
                
                sendEvent("onDebugLog", mapOf("message" to "isSleepTrackingAlive: $isAlive"))
                promise.resolve(isAlive)
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Error checking tracking status: ${e.message}"))
                promise.reject("STATUS_CHECK_ERROR", "Failed to check tracking status: ${e.message}", e)
            }
        }
        
        AsyncFunction("connectSleepTracking") { promise: Promise ->
            try {
                // This function assumes the caller has already verified the service is alive
                // The TypeScript layer checks isSleepTrackingAlive before calling this
                sendEvent("onDebugLog", mapOf("message" to "Restoring connection to sleep tracking service..."))
                
                // Mark tracking as active
                isTracking = true
                
                // Re-establish the tracking listener to receive events from the existing service
                // This ensures we continue to receive tracking events even after app restart
                Asleep.connectSleepTracking(object : Asleep.AsleepTrackingListener {
                    override fun onFail(errorCode: Int, detail: String) {
                        sendEvent("onDebugLog", mapOf("message" to "Sleep tracking failed: $errorCode - $detail"))
                        sendEvent("onTrackingFailed", mapOf("errorCode" to errorCode, "detail" to detail))
                    }
                    
                    override fun onFinish(sessionId: String?) {
                        isTracking = false
                        sendEvent("onTrackingClosed", mapOf("sessionId" to (sessionId ?: "")))
                        sendEvent("onDebugLog", mapOf("message" to "Sleep tracking finished: $sessionId"))
                    }
                    
                    override fun onPerform(sequence: Int) {
                        sendEvent("onTrackingUploaded", mapOf("sequence" to sequence))
                        sendEvent("onDebugLog", mapOf("message" to "Sleep tracking performing: $sequence"))
                    }
                    
                    override fun onStart(sessionId: String) {
                        // This shouldn't be called for reconnection, but handle it just in case
                        isTracking = true
                        sendEvent("onTrackingCreated", mapOf("sessionId" to sessionId))
                        sendEvent("onDebugLog", mapOf("message" to "Sleep tracking started: $sessionId"))
                    }
                })
                
                sendEvent("onDebugLog", mapOf("message" to "Successfully restored connection to existing sleep tracking service"))
                promise.resolve(true)
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Error connecting to tracking service: ${e.message}"))
                promise.reject("CONNECTION_ERROR", "Failed to connect to tracking service: ${e.message}", e)
            }
        }
        
        AsyncFunction("startTracking") { config: Map<String, Any>?, promise: Promise ->
            try {
                val audioPermission = ContextCompat.checkSelfPermission(appContext.reactContext!!, Manifest.permission.RECORD_AUDIO)
                val fgsPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ContextCompat.checkSelfPermission(appContext.reactContext!!, Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
                } else {
                    sendEvent("onDebugLog", mapOf("message" to "Requesting permissions"))
                    PackageManager.PERMISSION_GRANTED
                }
                if (audioPermission != PackageManager.PERMISSION_GRANTED || fgsPermission != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(
                        appContext.currentActivity!!,
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            sendEvent("onDebugLog", mapOf("message" to "Requesting permissions"))
                            arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
                        } else {
                            sendEvent("onDebugLog", mapOf("message" to "Requesting permissions"))
                            arrayOf(Manifest.permission.RECORD_AUDIO)
                        },
                        MICROPHONE_PERMISSION_REQUEST_CODE
                    )
                }



                
                sendEvent("onDebugLog", mapOf("message" to "Starting tracking"))
                if (_asleepConfig == null) {
                    sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is not initialized"))
                    promise.reject("UNINITIALIZED_CONFIG", "AsleepConfig is not initialized", null)
                    return@AsyncFunction
                } else {
                    sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is initialized"))
                }

                sendEvent("onDebugLog", mapOf("message" to "Starting tracking!"))
                
                // Extract Android notification settings from config
                val notification = (config?.get("android") as? Map<*, *>)
                    ?.get("notification") as? Map<*, *>
                
                val context = appContext.reactContext!!
                val notificationTitle = notification?.get("title") as? String ?: "Sleep Tracking"
                val notificationText = notification?.get("text") as? String ?: "Monitoring your sleep"
                val notificationIcon = notification?.get("icon")?.let { iconName ->
                    context.resources.getIdentifier(iconName as String, "drawable", context.packageName)
                } ?: context.applicationInfo.icon
                
                val processAlive = Asleep.isSleepTrackingAlive(context)
                sendEvent("onDebugLog", mapOf("message" to "$processAlive"))
                
                Asleep.beginSleepTracking(
                    asleepConfig = _asleepConfig!!,
                    notificationClass = appContext.currentActivity?.javaClass,
                    notificationTitle = notificationTitle,
                    notificationText = notificationText,
                    notificationIcon = notificationIcon,
                    asleepTrackingListener = object : Asleep.AsleepTrackingListener {
                        override fun onFail(errorCode: Int, detail: String) {
                            sendEvent("onDebugLog", mapOf("message" to "Sleep tracking failed: $errorCode - $detail"))
                            promise.reject("TRACKING_FAILED", "Sleep tracking failed: $errorCode - $detail", null)
                        }
                        
                        override fun onFinish(sessionId: String?) {
                            isTracking = false
                            sendEvent("onTrackingClosed", mapOf("sessionId" to (sessionId ?: "")))
                            sendEvent("onDebugLog", mapOf("message" to "Sleep tracking finished: $sessionId"))
                        }
                        
                        override fun onPerform(sequence: Int) {
                            sendEvent("onTrackingUploaded", mapOf("sequence" to sequence))
                            sendEvent("onDebugLog", mapOf("message" to "Sleep tracking performing: $sequence"))
                        }
                        
                        override fun onStart(sessionId: String) {
                            isTracking = true
                            sendEvent("onTrackingCreated", mapOf("sessionId" to sessionId))
                            sendEvent("onDebugLog", mapOf("message" to "Sleep tracking started: $sessionId"))
                            promise.resolve(mapOf("sessionId" to sessionId))
                        }
                    }
                )

                sendEvent("onDebugLog", mapOf("message" to "Tracking started"))
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Failed to start tracking: ${e.message}"))
                promise.reject("UNEXPECTED_ERROR", "Failed to start tracking: ${e.message}", e)
            }
        }

        Function("isTracking") {
            return@Function isTracking
        }

        AsyncFunction("stopTracking") { promise: Promise ->
            Asleep.endSleepTracking()
            isTracking = false
            promise.resolve("Tracking stopped")
        }

        AsyncFunction("getReport") { sessionId: String, promise: Promise ->
            try {
                if (_reportManager == null) {
                    promise.reject("UNINITIALIZED_REPORT_MANAGER", "Report manager is not initialized", null)
                }
                _reportManager?.getReport(sessionId, object : Reports.ReportListener {
                    override fun onSuccess(report: Report?) {
                        sendEvent("onDebugLog", mapOf("message" to "Report retrieval successful: ${report?.serializeToMap()}"))
                        promise.resolve(report?.serializeToMap())
                    }
                    override fun onFail(errorCode: Int, detail: String) {
                        val errorMessage = "Report retrieval failed: errorCode=$errorCode, detail=$detail"
                        sendEvent("onDebugLog", mapOf("message" to errorMessage))
                        promise.reject("REPORT_ERROR", errorMessage, null)
                    }
                })
            } catch (e: Exception) {
                val errorMessage = "Report retrieval failed: ${e.message}"
                sendEvent("onDebugLog", mapOf("message" to errorMessage))
                promise.reject("UNEXPECTED_ERROR", errorMessage, e)
            }
        }

        

        AsyncFunction("getReportList") { fromDate: String, toDate: String, promise: Promise ->
            try {
                if (_reportManager == null) {
                    promise.reject("UNINITIALIZED_REPORT_MANAGER", "Report manager is not initialized", null)
                }
                _reportManager?.getReports(
                    fromDate, 
                    toDate,  
                    orderBy = "DESC", 
                    offset = 0, 
                    limit = 100, 
                object : Reports.ReportsListener {
                    override fun onSuccess(reports: List<SleepSession>?) {
                        sendEvent("onDebugLog", mapOf("message" to "Get report list success: ${reports?.map { it.serializeToMap() } ?: emptyList()}"))
                        promise.resolve(reports?.map { it.serializeToMap() } ?: emptyList<Map<String, Any>>())
                    }
                    override fun onFail(errorCode: Int, detail: String) {
                        val errorMessage = "Get report list failed: errorCode=$errorCode, detail=$detail"
                        sendEvent("onDebugLog", mapOf("message" to errorMessage))
                    }
                })
            } catch (e: Exception) {
                val errorMessage = "Get report list failed: ${e.message}"
                sendEvent("onDebugLog", mapOf("message" to errorMessage))
            }
        }

        AsyncFunction("deleteSession") { sessionId: String, promise: Promise ->
            try {
                if (_reportManager == null) {
                    promise.reject("UNINITIALIZED_REPORT_MANAGER", "Report manager is not initialized", null)
                    return@AsyncFunction
                }

                sendEvent("onDebugLog", mapOf("message" to "deleteSession: $sessionId"))

                _reportManager?.deleteReport(sessionId, object : Reports.DeleteReportListener {
                    override fun onSuccess(sessionId: String?) {
                        sendEvent("onDebugLog", mapOf("message" to "deleteSession completed for sessionId: $sessionId"))
                        promise.resolve("Session deleted successfully")
                    }

                    override fun onFail(errorCode: Int, detail: String) {
                        val errorMessage = "Delete session failed: errorCode=$errorCode, detail=$detail"
                        sendEvent("onDebugLog", mapOf("message" to errorMessage))
                        promise.reject("DELETE_ERROR", errorMessage, null)
                    }
                })
            } catch (e: Exception) {
                val errorMessage = "Delete session failed: ${e.message}"
                sendEvent("onDebugLog", mapOf("message" to errorMessage))
                promise.reject("UNEXPECTED_ERROR", errorMessage, e)
            }
        }

        AsyncFunction("getAverageReport") { fromDate: String, toDate: String, promise: Promise ->
            try {
                if (_reportManager == null) {
                    promise.reject("UNINITIALIZED_REPORT_MANAGER", "Report manager is not initialized", null)
                    return@AsyncFunction
                }

                sendEvent("onDebugLog", mapOf("message" to "getAverageReport: fromDate=$fromDate, toDate=$toDate"))

                _reportManager?.getAverageReport(fromDate, toDate, object : Reports.AverageReportListener {
                    override fun onSuccess(averageReport: ai.asleep.asleepsdk.data.AverageReport?) {
                        sendEvent("onDebugLog", mapOf("message" to "Average report retrieval successful"))
                        promise.resolve(averageReport?.serializeToMap())
                    }

                    override fun onFail(errorCode: Int, detail: String) {
                        val errorMessage = "Average report retrieval failed: errorCode=$errorCode, detail=$detail"
                        sendEvent("onDebugLog", mapOf("message" to errorMessage))
                        promise.reject("AVERAGE_REPORT_ERROR", errorMessage, null)
                    }
                })
            } catch (e: Exception) {
                val errorMessage = "Average report retrieval failed: ${e.message}"
                sendEvent("onDebugLog", mapOf("message" to errorMessage))
                promise.reject("UNEXPECTED_ERROR", errorMessage, e)
            }
        }

        // Deprecated method for backward compatibility
        AsyncFunction("requestMicrophonePermission") { promise: Promise ->
            // Delegate to the new method
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val permissions = mutableListOf(android.Manifest.permission.RECORD_AUDIO)
                    
                    // Add notification permission for Android 13+
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        permissions.add(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                    
                    // Request permissions
                    val permissionsArray = permissions.toTypedArray()
                    if (appContext.currentActivity != null) {
                        ActivityCompat.requestPermissions(
                            appContext.currentActivity!!,
                            permissionsArray,
                            100
                        )
                    }
                    
                    // Check granted status
                    val allGranted = permissions.all { permission ->
                        ContextCompat.checkSelfPermission(appContext.reactContext!!, permission) == 
                            PackageManager.PERMISSION_GRANTED
                    }
                    
                    promise.resolve(allGranted)
                } catch (e: Exception) {
                    promise.reject("PERMISSION_ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("requestRequiredPermissions") { promise: Promise ->
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val audioPermission = ContextCompat.checkSelfPermission(appContext.reactContext!!, Manifest.permission.RECORD_AUDIO)
                    val fgsPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ContextCompat.checkSelfPermission(appContext.reactContext!!, Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
                    } else {
                        PackageManager.PERMISSION_GRANTED
                    }

                    if (audioPermission != PackageManager.PERMISSION_GRANTED || fgsPermission != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(
                            appContext.currentActivity!!,
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
                            } else {
                                arrayOf(Manifest.permission.RECORD_AUDIO)
                            },
                            MICROPHONE_PERMISSION_REQUEST_CODE
                        )
                        promise.resolve(false)
                    } else {
                        promise.resolve(true)
                    }
                } catch (e: Exception) {
                    promise.reject("PERMISSION_ERROR", "Error requesting microphone permission: ${e.message}", e)
                }
            }
        }

        AsyncFunction("requestAnalysis") { promise: Promise ->
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    if (_asleepConfig == null) {
                        promise.reject("UNINITIALIZED_CONFIG", "AsleepConfig is not initialized", null)
                        return@launch
                    }

                    var retryCount = 0
                    val maxRetries = 3
                    val delayMs = 5000L // 5 seconds

                    while (retryCount < maxRetries) {
                        if (isTracking) {
                            // If tracking is active, request analysis
                            try {
                                Asleep.getCurrentSleepData(object : Asleep.AsleepSleepDataListener {
                                    override fun onSleepDataReceived(session: ai.asleep.asleepsdk.data.Session) {
                                        val sessionData = session.serializeToMap()
                                        sendEvent("onAnalysisResult", sessionData)
                                        sendEvent("onDebugLog", mapOf("message" to "Request analysis result: $sessionData"))
                                        promise.resolve(sessionData)
                                    }

                                    override fun onFail(errorCode: Int, detail: String) {
                                        val errorMessage = "Get current sleep data failed: errorCode=$errorCode, detail=$detail"
                                        sendEvent("onDebugLog", mapOf("message" to errorMessage))
                                        promise.reject("ANALYSIS_ERROR", errorMessage, null)
                                    }
                                })
                                return@launch
                            } catch (e: Exception) {
                                val errorMessage = "Analysis request failed during getCurrentSleepData: ${e.message}"
                                sendEvent("onDebugLog", mapOf("message" to errorMessage))
                                promise.reject("ANALYSIS_ERROR", errorMessage, e)
                                return@launch
                            }
                        } else {
                            retryCount++
                            sendEvent("onDebugLog", mapOf("message" to "Sleep tracking not active, retry $retryCount/$maxRetries"))
                            
                            if (retryCount < maxRetries) {
                                delay(delayMs)
                            }
                        }
                    }

                    // All retries failed
                    val errorMessage = "Sleep tracking is not active after $maxRetries retries"
                    sendEvent("onDebugLog", mapOf("message" to errorMessage))
                    promise.reject("NOT_TRACKING", errorMessage, null)
                    
                } catch (e: Exception) {
                    val errorMessage = "Analysis request failed: ${e.message}"
                    sendEvent("onDebugLog", mapOf("message" to errorMessage))
                    promise.reject("UNEXPECTED_ERROR", errorMessage, e)
                }
            }
        }
        
        // Battery optimization check function - minimal implementation
        AsyncFunction("isBatteryOptimizationExempted") { promise: Promise ->
            try {
                // API 23+ required for battery optimization checks
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val context = appContext.reactContext!!
                    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    val packageName = context.packageName
                    val isExempted = pm.isIgnoringBatteryOptimizations(packageName)
                    promise.resolve(isExempted)
                } else {
                    // For older Android versions, return true (no battery optimization restrictions)
                    sendEvent("onDebugLog", mapOf("message" to "Battery optimization not applicable for API < 23"))
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Error checking battery optimization: ${e.message}"))
                promise.resolve(false)
            }
        }
        
        AsyncFunction("requestBatteryOptimizationExemption") { promise: Promise ->
            try {
                // API 23+ required for battery optimization
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val context = appContext.reactContext!!
                    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    val packageName = context.packageName
                    
                    // Check if already exempted
                    if (pm.isIgnoringBatteryOptimizations(packageName)) {
                        sendEvent("onDebugLog", mapOf("message" to "Battery optimization already exempted"))
                        promise.resolve(true)
                        return@AsyncFunction
                    }
                    
                    // Open battery optimization settings
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    intent.data = Uri.parse("package:$packageName")
                    appContext.currentActivity?.startActivity(intent)
                    
                    sendEvent("onDebugLog", mapOf("message" to "Opened battery optimization settings"))
                    promise.resolve(false)  // Settings opened, not exempted yet
                } else {
                    // For older Android versions, return true (no battery optimization restrictions)
                    sendEvent("onDebugLog", mapOf("message" to "Battery optimization not applicable for API < 23"))
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Error opening battery settings: ${e.message}"))
                promise.reject("SETTINGS_ERROR", "Cannot open battery optimization settings", e)
            }
        }
    }

    private fun <T> T.serializeToMap(): Map<String, Any> {
        return convert()
    }

    private inline fun <reified T> Map<String, Any>.toDataClass(): T {
        return convert()
    }

    private inline fun <I, reified O> I.convert(): O {
        val json = gson.toJson(this)
        return gson.fromJson(json, object : TypeToken<O>() {}.type)
    }

    private suspend fun requestMicrophonePermission(): Boolean = suspendCancellableCoroutine { cont ->
        val activity = appContext.currentActivity
        if (activity != null) {
            val permission = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
            if (permission != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE_PERMISSION_REQUEST_CODE)
                cont.resume(false)
            } else {
                cont.resume(true)
            }
        } else {
            cont.resumeWithException(Exception("Activity is null, cannot request microphone permission"))
        }
    }
}
