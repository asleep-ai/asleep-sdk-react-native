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



                
                val context = appContext.reactContext!!.applicationContext as Application
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

        AsyncFunction("requestMicrophonePermission") { promise: Promise ->
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
