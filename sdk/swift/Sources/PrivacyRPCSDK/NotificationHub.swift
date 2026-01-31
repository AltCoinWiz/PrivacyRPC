import Foundation

/// Notification Hub for PrivacyRPC
///
/// Central notification management matching the Chrome extension's
/// notification system with throttling, type-based filtering,
/// and multi-channel support.
public class NotificationHub {

    // MARK: - Notification Types

    public enum NotificationType: String, CaseIterable {
        case torConnected = "TOR_CONNECTED"
        case torDisconnected = "TOR_DISCONNECTED"
        case proxyError = "PROXY_ERROR"
        case protectionOn = "PROTECTION_ON"
        case protectionOff = "PROTECTION_OFF"
        case suspiciousRpc = "SUSPICIOUS_RPC"
        case extWarning = "EXT_WARNING"
        case unprotectedDApp = "UNPROTECTED_DAPP"
        case rpcBlocked = "RPC_BLOCKED"

        public var priority: Int {
            switch self {
            case .proxyError, .suspiciousRpc: return 100
            case .torConnected, .torDisconnected, .protectionOff, .extWarning, .rpcBlocked: return 80
            case .protectionOn, .unprotectedDApp: return 50
            }
        }

        public var supportsNative: Bool {
            switch self {
            case .unprotectedDApp, .rpcBlocked: return false
            default: return true
            }
        }

        public var supportsOverlay: Bool {
            switch self {
            case .torConnected, .torDisconnected, .protectionOn: return false
            default: return true
            }
        }
    }

    // MARK: - Settings

    public struct Settings {
        public var nativeEnabled: Bool
        public var overlayEnabled: Bool
        public var native: NativeSettings
        public var overlay: OverlaySettings
        public var throttling: ThrottlingSettings

        public init(
            nativeEnabled: Bool = true,
            overlayEnabled: Bool = true,
            native: NativeSettings = NativeSettings(),
            overlay: OverlaySettings = OverlaySettings(),
            throttling: ThrottlingSettings = ThrottlingSettings()
        ) {
            self.nativeEnabled = nativeEnabled
            self.overlayEnabled = overlayEnabled
            self.native = native
            self.overlay = overlay
            self.throttling = throttling
        }
    }

    public struct NativeSettings {
        public var torConnected = true
        public var torDisconnected = true
        public var proxyError = true
        public var protectionStatusChange = true
        public var suspiciousActivity = true
        public var extensionWarning = true

        public init() {}
    }

    public struct OverlaySettings {
        public var securityWarnings = true
        public var rpcBlocked = true
        public var suspiciousExtension = true
        public var unprotectedWarning = true

        public init() {}
    }

    public struct ThrottlingSettings {
        public var rpcActivityCooldown: TimeInterval = 30
        public var proxyErrorCooldown: TimeInterval = 60
        public var maxPerMinute: Int = 5

        public init() {}
    }

    // MARK: - Notification

    public struct Notification {
        public let type: NotificationType
        public let title: String
        public let message: String
        public let priority: Int
        public let actions: [NotificationAction]
        public let timestamp: Date

        public init(
            type: NotificationType,
            title: String,
            message: String,
            priority: Int? = nil,
            actions: [NotificationAction] = [],
            timestamp: Date = Date()
        ) {
            self.type = type
            self.title = title
            self.message = message
            self.priority = priority ?? type.priority
            self.actions = actions
            self.timestamp = timestamp
        }
    }

    public struct NotificationAction {
        public let label: String
        public let action: String

        public init(label: String, action: String) {
            self.label = label
            self.action = action
        }
    }

    public struct NotifyResult {
        public let throttled: Bool
        public let nativeSent: Bool
        public let overlaySent: Bool
    }

    // MARK: - Callbacks

    public typealias NativeSender = (Notification) -> Bool
    public typealias OverlaySender = (Notification) -> Bool
    public typealias ActionHandler = (String, String) -> Void

    // MARK: - State

    public var settings: Settings

    private var lastNotifications: [NotificationType: Date] = [:]
    private var recentTimestamps: [Date] = []
    private var nativeSender: NativeSender?
    private var overlaySender: OverlaySender?
    private var actionHandler: ActionHandler?

    public init(settings: Settings = Settings()) {
        self.settings = settings
    }

    // MARK: - Configuration

    public func setNativeSender(_ sender: @escaping NativeSender) {
        nativeSender = sender
    }

    public func setOverlaySender(_ sender: @escaping OverlaySender) {
        overlaySender = sender
    }

    public func setActionHandler(_ handler: @escaping ActionHandler) {
        actionHandler = handler
    }

    // MARK: - Core

    /// Send a notification through configured channels
    @discardableResult
    public func notify(_ notification: Notification) -> NotifyResult {
        if shouldThrottle(notification.type) {
            return NotifyResult(throttled: true, nativeSent: false, overlaySent: false)
        }

        var nativeSent = false
        var overlaySent = false

        if isEnabled(notification.type, channel: .native) {
            nativeSent = nativeSender?(notification) ?? false
        }

        if isEnabled(notification.type, channel: .overlay) {
            overlaySent = overlaySender?(notification) ?? false
        }

        if nativeSent || overlaySent {
            recordNotification(notification.type)
        }

        return NotifyResult(throttled: false, nativeSent: nativeSent, overlaySent: overlaySent)
    }

    /// Handle a notification action
    public func handleAction(notificationId: String, action: String) {
        actionHandler?(notificationId, action)
    }

    // MARK: - Private

    private enum Channel { case native, overlay }

    private func shouldThrottle(_ type: NotificationType) -> Bool {
        let now = Date()

        // Clean old entries
        recentTimestamps.removeAll { now.timeIntervalSince($0) >= 60 }

        // Global rate limit
        if recentTimestamps.count >= settings.throttling.maxPerMinute {
            return true
        }

        // Per-type cooldown
        if let lastTime = lastNotifications[type] {
            let cooldown: TimeInterval
            switch type {
            case .suspiciousRpc, .rpcBlocked:
                cooldown = settings.throttling.rpcActivityCooldown
            case .proxyError:
                cooldown = settings.throttling.proxyErrorCooldown
            default:
                cooldown = 0
            }

            if cooldown > 0 && now.timeIntervalSince(lastTime) < cooldown {
                return true
            }
        }

        return false
    }

    private func recordNotification(_ type: NotificationType) {
        let now = Date()
        lastNotifications[type] = now
        recentTimestamps.append(now)
    }

    private func isEnabled(_ type: NotificationType, channel: Channel) -> Bool {
        switch channel {
        case .native:
            guard settings.nativeEnabled, type.supportsNative else { return false }
            switch type {
            case .torConnected: return settings.native.torConnected
            case .torDisconnected: return settings.native.torDisconnected
            case .proxyError: return settings.native.proxyError
            case .protectionOn, .protectionOff: return settings.native.protectionStatusChange
            case .suspiciousRpc: return settings.native.suspiciousActivity
            case .extWarning: return settings.native.extensionWarning
            default: return true
            }

        case .overlay:
            guard settings.overlayEnabled, type.supportsOverlay else { return false }
            switch type {
            case .proxyError, .protectionOff, .suspiciousRpc: return settings.overlay.securityWarnings
            case .rpcBlocked: return settings.overlay.rpcBlocked
            case .extWarning: return settings.overlay.suspiciousExtension
            case .unprotectedDApp: return settings.overlay.unprotectedWarning
            default: return true
            }
        }
    }
}
