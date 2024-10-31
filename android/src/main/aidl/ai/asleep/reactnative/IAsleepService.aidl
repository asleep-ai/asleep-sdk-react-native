// IAsleepService.aidl
package ai.asleep.reactnative;

import ai.asleep.reactnative.IListener;

interface IAsleepService {
    void registerListener(IListener listener);
    void unregisterListener(IListener listener);
}