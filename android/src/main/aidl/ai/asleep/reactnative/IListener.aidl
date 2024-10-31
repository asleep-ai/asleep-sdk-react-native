// IListener.aidl
package ai.asleep.reactnative;

import ai.asleep.reactnative.data.ErrorCode;

interface IListener {
    void onUserIdReceived(String userId);
    void onSessionIdReceived(String sessionId);
    void onSequenceReceived(int sequence);
    void onErrorCodeReceived(in ErrorCode errorCode);
    void onStopTrackingReceived(String sessionId);
} 