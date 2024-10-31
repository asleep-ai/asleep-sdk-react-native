package ai.asleep.reactnative.service

import ai.asleep.reactnative.R
import ai.asleep.reactnative.utils.PreferenceHelper
import ai.asleep.reactnative.data.ErrorCode
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.media.AudioManager
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.LifecycleService
import android.Manifest
import android.content.pm.PackageManager


const val TAG = ">>>>> AsleepService"
class AsleepService : LifecycleService() {

    lateinit var asleepViewModel: AsleepViewModel

    companion object {
        private const val FOREGROUND_SERVICE_ID = 1000
        private const val RECORD_NOTIFICATION_CHANNEL_ID = "12344321"

        const val ACTION_START_TRACKING = "ACTION_START_TRACKING"
        const val ACTION_STOP_TRACKING = "ACTION_STOP_TRACKING"

        fun isAsleepServiceRunning(context: Context): Boolean {
            val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            @Suppress("DEPRECATION")
            for (service in manager.getRunningServices(Int.MAX_VALUE)) {
                if (AsleepService::class.java.name == service.service.className) {
                    return true
                }
            }
            return false
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "AsleepService onCreate: ")
        createNotificationChannel()   
        
        asleepViewModel = AsleepViewModel.getInstance(application)
        asleepViewModel.reportingSessionId.observe(this) {
            Log.d(TAG, "reportingSessionId : $it")
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        Log.d(TAG, "onStartCommand:")

        if (intent == null || intent.action == null) {
            asleepViewModel.continueTracking()
        } else if (intent.action == ACTION_START_TRACKING) {
            startForegroundService()
            
            val storedUserId = PreferenceHelper.getUserId(applicationContext)
            val apiKey = PreferenceHelper.getApiKey(applicationContext)
            asleepViewModel.startSleepTracking(storedUserId, apiKey)
        } else if (intent.action == ACTION_STOP_TRACKING) {
            asleepViewModel.stopSleepTracking()
            asleepViewModel.isReporting = true
            stopForeground(true)
            stopSelf()
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationChannel =
                NotificationChannel(
                    RECORD_NOTIFICATION_CHANNEL_ID,
                    "Asleep Tracking In Progress",
                    NotificationManager.IMPORTANCE_LOW
                )
            notificationChannel.setSound(null, null)
            NotificationManagerCompat.from(applicationContext)
                .createNotificationChannel(notificationChannel)
        }
    }

    private fun startForegroundService() {

        val notification = getNotification()
       
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.FOREGROUND_SERVICE_MICROPHONE) == PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                startForeground(FOREGROUND_SERVICE_ID, notification, FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                Log.e(TAG, "Missing required permissions for foreground service with microphone")
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(FOREGROUND_SERVICE_ID, notification, FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(FOREGROUND_SERVICE_ID, notification)
        }

        Log.d(TAG, "startForeground()")
    }

    private fun getNotification(): Notification {
        val notificationIntent = packageManager
        .getLaunchIntentForPackage(packageName)
        ?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

    val pendingIntent = PendingIntent.getActivity(
        this,
        0,
        notificationIntent,
        PendingIntent.FLAG_IMMUTABLE
    )

    val notificationTitle = PreferenceHelper.getNotificationTitle(applicationContext)
    val notificationText = PreferenceHelper.getNotificationText(applicationContext)

    val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, RECORD_NOTIFICATION_CHANNEL_ID)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    } else {
        Notification.Builder(this)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
        }

        return notification
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return asleepViewModel.binder
    }

    override fun onDestroy() {
        try {
            super.onDestroy()
            Log.d(TAG, "AsleepService onDestroy")
            asleepViewModel.cleanup()
            stopForeground(true)
            
             
            applicationContext?.let { context ->
                try {
                     
                    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.abandonAudioFocus(null)
                } catch (e: Exception) {
                    Log.e(TAG, "Error cleaning up audio resources", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in onDestroy", e)
        }
    }
}
