package ai.asleep.reactnative.service

import ai.asleep.reactnative.BuildConfig
import ai.asleep.reactnative.IAsleepService
import ai.asleep.reactnative.IListener
import ai.asleep.reactnative.data.ErrorCode
import ai.asleep.reactnative.utils.PreferenceHelper
import ai.asleep.asleepsdk.Asleep
import ai.asleep.asleepsdk.AsleepErrorCode
import ai.asleep.asleepsdk.data.AsleepConfig
import ai.asleep.asleepsdk.tracking.SleepTrackingManager
import ai.asleep.asleepsdk.tracking.TrackingStatus
import android.app.Application
import android.os.RemoteCallbackList
import android.os.RemoteException
import android.util.Log
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel

class AsleepViewModel private constructor(
    private val applicationContext: Application
) : ViewModel() {

    private var _userId = MutableLiveData<String?>()
    val userId: LiveData<String?> get() = _userId
    private var _asleepConfig: AsleepConfig? = null

    private var _sleepTrackingManager: SleepTrackingManager? = null
    private var _sessionId: String? = null
    private var _sequence = MutableLiveData<Int?>(null)

    var isReporting = false
    val reportingSessionId = MutableLiveData<String>()

    private val listeners = RemoteCallbackList<IListener>()
    val binder: IAsleepService.Stub = object : IAsleepService.Stub() {
        @Throws(RemoteException::class)
        override fun registerListener(listener: IListener?) {
            listeners.register(listener)
        }

        @Throws(RemoteException::class)
        override fun unregisterListener(listener: IListener?) {
            listeners.unregister(listener)
        }
    }

    fun startSleepTracking(userId: String?, apiKey: String) {
        Asleep.initAsleepConfig(
            context = applicationContext,
            apiKey = apiKey,
            userId = userId,
            baseUrl = null,
            callbackUrl = null,
            service = "SleepTracking",
            object : Asleep.AsleepConfigListener {
                override fun onSuccess(userId: String?, asleepConfig: AsleepConfig?) {
                    saveUserIdInSharedPreference(userId)
                    _userId.value = userId
                    _asleepConfig = asleepConfig

                    notifyListeners(listeners) { listener ->
                        (listener).onUserIdReceived(userId)
                    }

                    createSleepTrackingManager()
                    startTracking()
                }

                override fun onFail(errorCode: Int, detail: String) {
                    Log.d("initAsleepConfig", "onFail: $errorCode - $detail")
                    notifyListeners(listeners) { listener ->
                        listener.onErrorCodeReceived(ErrorCode(errorCode, detail))
                    }

                }
            },
            object : Asleep.AsleepLogger {
                override fun d(tag: String, msg: String, throwable: Throwable?) {
                    if (throwable == null) {
                        Log.d(tag, msg)
                    } else {
                        Log.d(tag, "$msg ${throwable.localizedMessage}")
                    }
                }

                override fun e(tag: String, msg: String, throwable: Throwable?) {
                    if (throwable == null) {
                        Log.e(tag, msg)
                    } else {
                        Log.e(tag, "$msg ${throwable.localizedMessage}")
                    }
                }

                override fun i(tag: String, msg: String, throwable: Throwable?) {
                    if (throwable == null) {
                        Log.i(tag, msg)
                    } else {
                        Log.i(tag, "$msg ${throwable.localizedMessage}")
                    }
                }

                override fun w(tag: String, msg: String, throwable: Throwable?) {
                    if (throwable == null) {
                        Log.w(tag, msg)
                    } else {
                        Log.w(tag, "$msg ${throwable.localizedMessage}")
                    }
                }
            })
    }

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    fun createSleepTrackingManager() {
        _sleepTrackingManager = Asleep.createSleepTrackingManager(_asleepConfig, object : SleepTrackingManager.TrackingListener {
            override fun onCreate() {
                mainHandler.post {
                    _sessionId = getTrackingStatus()?.sessionId
                    _sessionId?.let {
                        notifyListeners(listeners) { listener ->
                            listener.onSessionIdReceived(it)
                        }
                    }
                }
            }

            override fun onUpload(sequence: Int) {
                mainHandler.post {
                    _sequence.value = sequence

                    notifyListeners(listeners) { listener ->
                        listener.onSequenceReceived(sequence)
                    }
                }
            }

            override fun onClose(sessionId: String) {
                _sessionId = sessionId

                mainHandler.post {
                    PreferenceHelper.putIsTracking(applicationContext, false)
      
                    notifyListeners(listeners) { listener ->
                        listener.onStopTrackingReceived(_sessionId)
                    }

                    if (isReporting) {
                        _sessionId?.let {
                            reportingSessionId.value = it
                        }
                    }
                }
            }

            override fun onFail(errorCode: Int, detail: String) {
                mainHandler.post {
                    when (errorCode) {
                        AsleepErrorCode.ERR_CLOSE_SERVER_ERROR,
                        AsleepErrorCode.ERR_CLOSE_FAILED,
                        AsleepErrorCode.ERR_CLOSE_FORBIDDEN,
                        AsleepErrorCode.ERR_CLOSE_UNAUTHORIZED,
                        AsleepErrorCode.ERR_CLOSE_BAD_REQUEST,
                        AsleepErrorCode.ERR_CLOSE_NOT_FOUND ->
                            notifyListeners(listeners) { listener ->
                                listener.onStopTrackingReceived(_sessionId)
                            }
                        else ->
                            notifyListeners(listeners) { listener ->
                                listener.onErrorCodeReceived(ErrorCode(errorCode, detail))
                            }
                    }
                }
            }
        })
    }

    fun getTrackingStatus(): TrackingStatus? {
        return _sleepTrackingManager?.getTrackingStatus()
    }

    private fun startTracking() {
        _sleepTrackingManager?.startSleepTracking()
    }

    fun stopSleepTracking() {
        if (_sleepTrackingManager?.getTrackingStatus()?.sessionId != null) {
            _sleepTrackingManager?.stopSleepTracking()
        }
    }

    
    fun continueTracking() {
        if (_asleepConfig == null && Asleep.hasUnfinishedSession(applicationContext)) {  
            val savedApiKey = PreferenceHelper.getApiKey(applicationContext)
            _asleepConfig = Asleep.getSavedAsleepConfig(applicationContext, savedApiKey)
            createSleepTrackingManager()
            startTracking()
        }
    }

    private fun saveUserIdInSharedPreference(userId: String?) {
        userId?.let {
            PreferenceHelper.putUserId(applicationContext, it)
        }
    }

    private fun notifyListeners(listeners: RemoteCallbackList<IListener>, onReceive: (IListener) -> Unit) {
        val numListeners = listeners.beginBroadcast()
        for (i in 0 until numListeners) {
            try {
                val listener = listeners.getBroadcastItem(i)
                onReceive(listener)
            } catch (e: RemoteException) {
                e.printStackTrace()
            }
        }
        listeners.finishBroadcast()
    }

    fun cleanup() {
        try {
            stopSleepTracking()
            _sleepTrackingManager = null
            _asleepConfig = null
            listeners.kill()
            
            System.gc()
        } catch (e: Exception) {
            Log.e(TAG, "Error in cleanup", e)
        }
    }

    companion object {
        @Volatile
        private var instance: AsleepViewModel? = null

        fun getInstance(application: Application): AsleepViewModel {
            return instance ?: synchronized(this) {
                instance ?: AsleepViewModel(application).also { instance = it }
            }
        }
    }
}
