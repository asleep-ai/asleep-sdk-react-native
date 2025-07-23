import AVFoundation
import ObjectiveC

// MARK: - Temporary Audio Session Swizzling for Bluetooth Support
//
// PURPOSE: Enable recording from phone microphone while playing audio through AirPods/Bluetooth
// This allows users to track sleep sounds while listening to white noise through Bluetooth devices.
//
// IMPACT:
// - Adds Bluetooth A2DP as an available audio route option (doesn't force its use)
// - Will be removed when AsleepSDK natively supports this configuration
//
// TODO: Remove this entire file when AsleepSDK iOS implements proper audio configuration

extension AVAudioSession {
    private static let swizzleOnce: () = {
        let originalSelector = #selector(AVAudioSession.setCategory(_:mode:options:))
        let swizzledSelector = #selector(AVAudioSession.swizzled_setCategory(_:mode:options:))
        
        guard let originalMethod = class_getInstanceMethod(AVAudioSession.self, originalSelector),
              let swizzledMethod = class_getInstanceMethod(AVAudioSession.self, swizzledSelector) else {
            // Using assertionFailure will crash in debug builds if swizzling fails,
            // making the issue immediately obvious, while being a no-op in release builds.
            assertionFailure("Failed to swizzle AVAudioSession.setCategory. Bluetooth audio may not work as expected.")
            return
        }
        
        method_exchangeImplementations(originalMethod, swizzledMethod)
    }()
    
    static func swizzleSetCategory() {
        // This triggers the lazy initialization of swizzleOnce, ensuring the
        // swizzling code is executed exactly once in a thread-safe manner.
        _ = swizzleOnce
    }
    
    @objc private func swizzled_setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws {
        // Always add allowBluetoothA2DP to the options
        var modifiedOptions = options
        modifiedOptions.insert(.allowBluetoothA2DP)
        
        // Call the original implementation with modified options
        try swizzled_setCategory(category, mode: mode, options: modifiedOptions)
    }
}
