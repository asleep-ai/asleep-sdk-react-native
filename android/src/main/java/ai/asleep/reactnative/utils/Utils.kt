package ai.asleep.reactnative.utils

import android.os.Build
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal fun changeTimeFormat(time: String?): String? {
    if (time != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val inputFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")
            val outputFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

            val offsetDateTime = OffsetDateTime.parse(time, inputFormatter)
            val systemZone = ZoneId.systemDefault()
            val localDateTime = offsetDateTime.atZoneSameInstant(systemZone).toLocalDateTime()

            return localDateTime.format(outputFormatter)
        } else {
            val inputFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.getDefault())
            val date = inputFormatter.parse(time)
            val outputFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

            return outputFormatter.format(date)
        }
    }
    return null
}

internal fun getCurrentTime(): String {
    var time = ""
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val systemZone = ZoneId.systemDefault()
        val zonedDateTime = ZonedDateTime.now(systemZone)
        time = zonedDateTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
    } else {
        val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
        dateFormat.timeZone = TimeZone.getDefault()
        val currentTime = Date(System.currentTimeMillis())
        time = dateFormat.format(currentTime)
    }
    return time
}
