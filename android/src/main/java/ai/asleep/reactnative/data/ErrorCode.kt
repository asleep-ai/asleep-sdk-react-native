package ai.asleep.reactnative.data

import android.os.Parcel
import android.os.Parcelable

data class ErrorCode(
    val code: Int,
    val message: String
) : Parcelable {
    constructor(parcel: Parcel) : this(
        parcel.readInt(),
        parcel.readString() ?: ""
    )

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeInt(code)
        parcel.writeString(message)
    }

    override fun describeContents(): Int {
        return 0
    }

    companion object CREATOR : Parcelable.Creator<ErrorCode> {
        override fun createFromParcel(parcel: Parcel): ErrorCode {
            return ErrorCode(parcel)
        }

        override fun newArray(size: Int): Array<ErrorCode?> {
            return arrayOfNulls(size)
        }
    }
}