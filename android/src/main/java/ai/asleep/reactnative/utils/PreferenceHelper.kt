package ai.asleep.reactnative.utils

import android.content.Context
import android.content.SharedPreferences

class PreferenceHelper private constructor() {

    companion object {
        private const val PREF_NAME = "time_prefs"
        private const val START_TIME_HOUR_KEY = "start_time_hour"
        private const val START_TIME_MINUTE_KEY = "start_time_minute"
        private const val END_TIME_HOUR_KEY = "end_time_hour"
        private const val END_TIME_MINUTE_KEY = "end_time_minute"
        private const val ENABLE_TRACKING_KEY = "enable_tracking"
        private const val USER_ID = "user_id"
        private const val API_KEY = "api_key"
        private const val START_TRACKING_TIME = "start_tracking_time"
        private const val NOTIFICATION_TITLE = "notification_title"
        private const val NOTIFICATION_TEXT = "notification_text"
        private const val IS_TRACKING = "is_tracking"

        private fun getSharedPreferences(context: Context): SharedPreferences {
            return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        }

        fun putStartHour(context: Context, hour: Int) {
            getSharedPreferences(context).edit().putInt(START_TIME_HOUR_KEY, hour).apply()
        }

        fun getStartHour(context: Context): Int {
            return getSharedPreferences(context).getInt(START_TIME_HOUR_KEY, 23)  
        }

        fun putStartMinute(context: Context, minute: Int) {
            getSharedPreferences(context).edit().putInt(START_TIME_MINUTE_KEY, minute).apply()
        }

        fun getStartMinute(context: Context): Int {
            return getSharedPreferences(context).getInt(START_TIME_MINUTE_KEY, 30)  
        }

        fun putEndHour(context: Context, hour: Int) {
            getSharedPreferences(context).edit().putInt(END_TIME_HOUR_KEY, hour).apply()
        }

        fun getEndHour(context: Context): Int {
            return getSharedPreferences(context).getInt(END_TIME_HOUR_KEY, 7)  
        }

        fun putEndMinute(context: Context, minute: Int) {
            getSharedPreferences(context).edit().putInt(END_TIME_MINUTE_KEY, minute).apply()
        }

        fun getEndMinute(context: Context): Int {
            return getSharedPreferences(context).getInt(END_TIME_MINUTE_KEY, 0)  
        }

        fun putAutoTrackingEnabled(context: Context, isEnabled: Boolean) {
            getSharedPreferences(context).edit().putBoolean(ENABLE_TRACKING_KEY, isEnabled).apply()
        }

        fun isAutoTrackingEnabled(context: Context): Boolean {
            return getSharedPreferences(context).getBoolean(ENABLE_TRACKING_KEY, false)
        }


        fun putUserId(context: Context, userId: String) {
            getSharedPreferences(context).edit().putString(USER_ID, userId).apply()
        }

        fun getUserId(context: Context): String {
            return getSharedPreferences(context).getString(USER_ID, "")?:""
        }

        fun putApiKey(context: Context?, apiKey: String?) {
            if (context == null || apiKey == null) return
            getSharedPreferences(context).edit().putString(API_KEY, apiKey).apply()
        }

        fun getApiKey(context: Context?): String {
            if (context == null) return ""
            return getSharedPreferences(context).getString(API_KEY, "") ?: ""
        }

        fun putStartTrackingTime(context: Context, startTrackingTime: String) {
            getSharedPreferences(context).edit().putString(START_TRACKING_TIME, startTrackingTime).apply()
        }

        fun getStartTrackingTime(context: Context): String {
            return getSharedPreferences(context).getString(START_TRACKING_TIME, "")?:""
        }

        fun putNotificationTitle(context: Context, title: String) {
            getSharedPreferences(context).edit().putString(NOTIFICATION_TITLE, title).apply()
        }

        fun getNotificationTitle(context: Context): String {
            return getSharedPreferences(context).getString(NOTIFICATION_TITLE, "Sleep Tracking") ?: "Sleep Tracking"
        }

        fun putNotificationText(context: Context, text: String) {
            getSharedPreferences(context).edit().putString(NOTIFICATION_TEXT, text).apply()
        }

        fun getNotificationText(context: Context): String {
            return getSharedPreferences(context).getString(NOTIFICATION_TEXT, 
                "We're measuring your sleep. Don't worry, the measurement continues even when your phone screen is off🌙") 
                ?: "We're measuring your sleep. Don't worry, the measurement continues even when your phone screen is off🌙"
        }

        fun putIsTracking(context: Context, isTracking: Boolean) {
            getSharedPreferences(context).edit().putBoolean(IS_TRACKING, isTracking).apply()
        }

        fun isTracking(context: Context): Boolean {
            return getSharedPreferences(context).getBoolean(IS_TRACKING, false)
        }
    }
}
