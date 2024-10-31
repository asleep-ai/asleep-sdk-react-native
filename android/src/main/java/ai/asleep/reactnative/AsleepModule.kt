package ai.asleep.reactnative

import ai.asleep.asleepsdk.Asleep
import ai.asleep.asleepsdk.data.AsleepConfig
import ai.asleep.asleepsdk.data.Report
import ai.asleep.asleepsdk.data.SleepSession
import ai.asleep.reactnative.service.AsleepService
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
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import ai.asleep.reactnative.IAsleepService
import ai.asleep.reactnative.IListener
import ai.asleep.reactnative.data.ErrorCode
import ai.asleep.reactnative.utils.PreferenceHelper
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

    private var asleepService: IAsleepService? = null
    private var isBound = false

    val trackingState: LiveData<TrackingState> get() = _trackingState
    private var _trackingState = MutableLiveData(TrackingState.STATE_TRACKING_STOPPED)
    enum class TrackingState { STATE_TRACKING_STOPPED, STATE_TRACKING_STARTING, STATE_TRACKING_STARTED, STATE_TRACKING_STOPPING}

    companion object {
        public const val MICROPHONE_PERMISSION_REQUEST_CODE = 1001
    }


    private val listener = object : IListener.Stub() {
        override fun onUserIdReceived(userId: String) {
            sendEvent("onDebugLog", mapOf("message" to "onUserIdReceived: $userId"))
            sendEvent("onUserJoined", mapOf("userId" to userId))
        }

        override fun onSessionIdReceived(sessionId: String) {
            sendEvent("onDebugLog", mapOf("message" to "onSessionIdReceived: $sessionId"))
            sendEvent("onTrackingClosed", mapOf("sessionId" to sessionId))
            _sessionId.postValue(sessionId)
            _trackingState.postValue(TrackingState.STATE_TRACKING_STARTED)

        }

        override fun onSequenceReceived(sequence: Int) {
            sendEvent("onDebugLog", mapOf("message" to "onSequenceReceived: $sequence"))
            sendEvent("onTrackingUploaded", mapOf("sequence" to sequence))
            _sequence.postValue(sequence)
        }

        override fun onErrorCodeReceived(errorCode: ErrorCode) {
            sendEvent("onDebugLog", mapOf("message" to "onErrorCodeReceived: ${errorCode.code}"))
            sendEvent("onTrackingFailed", mapOf("errorCode" to errorCode.code))
        }

        override fun onStopTrackingReceived(sessionId: String) {
            sendEvent("onDebugLog", mapOf("message" to "onStopTrackingReceived: $sessionId"))
            sendEvent("onTrackingClosed", mapOf("sessionId" to sessionId))
            _sessionId.postValue(sessionId)
            _trackingState.postValue(TrackingState.STATE_TRACKING_STOPPED)
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            try {
                asleepService = IAsleepService.Stub.asInterface(service)
                asleepService?.registerListener(listener)
                isBound = true
            } catch (e: Exception) {
                Log.e("AsleepModule", "Service connection failed", e)
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            try {
                if (isBound) {
                    asleepService?.unregisterListener(listener)
                    asleepService = null
                    isBound = false

                    appContext.currentActivity?.let { activity ->
                        if (!activity.isFinishing) {
                            sendEvent("onServiceDisconnected", mapOf("message" to "Service disconnected"))
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("AsleepModule", "Service disconnection error", e)
            }
        }
    }


    fun bindService() {
        try {
            if (!isBound) {
                val intent = Intent(appContext.reactContext, AsleepService::class.java)
                appContext.reactContext?.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            }
        } catch (e: Exception) {
            Log.e("AsleepModule", "bindService failed", e)
        }
    }

    fun unbindService() {
        try {
            if (isBound) {
                appContext.reactContext?.unbindService(connection)
                asleepService = null
                isBound = false
            }
        } catch (e: Exception) {
            Log.e("AsleepModule", "unbindService failed", e)
        }
    }

    override fun definition() = ModuleDefinition {
        Name("Asleep")

        Events("onTrackingCreated", "onTrackingUploaded", "onTrackingClosed", "onTrackingFailed", "onUserJoined", "onUserJoinFailed", "onDebugLog")

        AsyncFunction("initAsleepConfig") { apiKey: String, userId: String?, baseUrl: String?, callbackUrl: String?, promise: Promise ->
            try {
                val context = appContext.reactContext!!.applicationContext as Application
                val isTracking = PreferenceHelper.isTracking(context)
                val savedApiKey = PreferenceHelper.getApiKey(context)
                val savedUserId = PreferenceHelper.getUserId(context)
                
                 
                if (isTracking && savedApiKey == apiKey && savedUserId == userId) {
                     
                    if (AsleepService.isAsleepServiceRunning(context)) {
                         
                        bindService()
                        promise.resolve("Service reconnected")
                        sendEvent("onDebugLog", mapOf("message" to "Service reconnected"))
                        return@AsyncFunction
                    }
                }

                 
                PreferenceHelper.putApiKey(context, apiKey)

                Asleep.initAsleepConfig(
                    context = appContext.reactContext!!.applicationContext as Application,
                    apiKey = apiKey,
                    userId = userId,
                    baseUrl = baseUrl,
                    callbackUrl = callbackUrl,
                    service = "SleepTracking",
                    object : Asleep.AsleepConfigListener {
                        override fun onSuccess(userId: String?, asleepConfig: AsleepConfig?) {
                            if (userId != null) {
                                PreferenceHelper.putUserId(appContext.reactContext!!.applicationContext as Application, userId)
                            }
                            _asleepConfig = asleepConfig

                            if (_asleepConfig != null) { 
                                _reportManager = Asleep.createReports(_asleepConfig)
                            } else {
                                sendEvent("onDebugLog", mapOf("message" to "AsleepConfig is null"))
                                promise.reject("CONFIG_ERROR", "AsleepConfig is null", null)
                                return
                            }

                            bindService()

                            promise.resolve("Initialization successful")
                            try {
                                sendEvent("onDebugLog", mapOf("message" to "Initialization successful"))
                            } catch (e: Exception) {
                                println("Error sending debug log: ${e.message}")
                            }
                        }

                        override fun onFail(errorCode: Int, detail: String) {
                            sendEvent("onDebugLog", mapOf("message" to "Initialization failed: $errorCode - $detail"))
                            promise.reject("INITIALIZATION_FAILED", "Initialization failed: $errorCode - $detail", null)
                        }
                    }
                )
                
            } catch (e: Exception) {
                sendEvent("onDebugLog", mapOf("message" to "Initialization failed: ${e.message}"))
                promise.reject("UNEXPECTED_ERROR", "Initialization failed: ${e.message}", e)
            }
        }
        
        AsyncFunction("startTracking") { promise: Promise ->
            val activity = appContext.currentActivity
            val context = appContext.reactContext!!.applicationContext as Application
            PreferenceHelper.putIsTracking(context, true)
            if (activity != null) {
                val intent = Intent(activity, AsleepService::class.java)
                intent.action = AsleepService.ACTION_START_TRACKING

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    activity.startForegroundService(intent)
                } else {
                    activity.startService(intent)
                }
                promise.resolve("Tracking started")
            } else {
                promise.reject("ACTIVITY_NOT_FOUND", "Activity not found", null)
            }
        }

        Function("isTracking") {
            val context = appContext.reactContext!!.applicationContext as Application
            return@Function PreferenceHelper.isTracking(context)
        }

        AsyncFunction("stopTracking") { promise: Promise ->
            val activity = appContext.currentActivity
            val context = appContext.reactContext!!.applicationContext as Application
            PreferenceHelper.putIsTracking(context, false)
            if (activity != null) {
                val intent = Intent(activity, AsleepService::class.java)
                intent.action = AsleepService.ACTION_STOP_TRACKING
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    activity.startForegroundService(intent)
                } else {
                    activity.startService(intent)
                }
                promise.resolve("Tracking stopped")
            } else {
                promise.reject("ACTIVITY_NOT_FOUND", "Activity not found", null)
            }

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

        AsyncFunction("setCustomNotification") { title: String, text: String, promise: Promise ->
            try {
                val context = appContext.reactContext!!.applicationContext as Application
                PreferenceHelper.putNotificationTitle(context, title)
                PreferenceHelper.putNotificationText(context, text)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("NOTIFICATION_ERROR", "Failed to set custom notification: ${e.message}", e)
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
