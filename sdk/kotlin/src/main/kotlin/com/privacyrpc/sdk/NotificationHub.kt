package com.privacyrpc.sdk

/**
 * Notification Hub for PrivacyRPC
 *
 * Central notification management matching the Chrome extension's
 * notification system with throttling, type-based filtering,
 * and multi-channel support.
 */
class NotificationHub(
    private var settings: NotificationSettings = NotificationSettings()
) {

    // ── Notification Types ───────────────────────────────────

    enum class NotificationType(
        val priority: Int,
        val supportsNative: Boolean,
        val supportsOverlay: Boolean
    ) {
        TOR_CONNECTED(80, true, false),
        TOR_DISCONNECTED(80, true, false),
        PROXY_ERROR(100, true, true),
        PROTECTION_ON(50, true, false),
        PROTECTION_OFF(80, true, true),
        SUSPICIOUS_RPC(100, true, true),
        EXT_WARNING(80, true, true),
        UNPROTECTED_DAPP(50, false, true),
        RPC_BLOCKED(80, false, true)
    }

    // ── Settings ─────────────────────────────────────────────

    data class NotificationSettings(
        val nativeEnabled: Boolean = true,
        val overlayEnabled: Boolean = true,
        val native: NativeSettings = NativeSettings(),
        val overlay: OverlaySettings = OverlaySettings(),
        val throttling: ThrottlingSettings = ThrottlingSettings()
    )

    data class NativeSettings(
        val torConnected: Boolean = true,
        val torDisconnected: Boolean = true,
        val proxyError: Boolean = true,
        val protectionStatusChange: Boolean = true,
        val suspiciousActivity: Boolean = true,
        val extensionWarning: Boolean = true
    )

    data class OverlaySettings(
        val securityWarnings: Boolean = true,
        val rpcBlocked: Boolean = true,
        val suspiciousExtension: Boolean = true,
        val unprotectedWarning: Boolean = true
    )

    data class ThrottlingSettings(
        val rpcActivityCooldownMs: Long = 30_000,
        val proxyErrorCooldownMs: Long = 60_000,
        val maxPerMinute: Int = 5
    )

    // ── Notification Data ────────────────────────────────────

    data class Notification(
        val type: NotificationType,
        val title: String,
        val message: String,
        val priority: Int = type.priority,
        val actions: List<NotificationAction> = emptyList(),
        val timestamp: Long = System.currentTimeMillis()
    )

    data class NotificationAction(
        val label: String,
        val action: String
    )

    data class NotifyResult(
        val throttled: Boolean = false,
        val nativeSent: Boolean = false,
        val overlaySent: Boolean = false
    )

    // ── Callback Interfaces ──────────────────────────────────

    fun interface NativeNotificationSender {
        fun send(notification: Notification): Boolean
    }

    fun interface OverlayNotificationSender {
        fun send(notification: Notification): Boolean
    }

    fun interface ActionHandler {
        fun handle(notificationId: String, action: String)
    }

    // ── State ────────────────────────────────────────────────

    private val lastNotifications = mutableMapOf<NotificationType, Long>()
    private val recentTimestamps = mutableListOf<Long>()
    private var nativeSender: NativeNotificationSender? = null
    private var overlaySender: OverlayNotificationSender? = null
    private var actionHandler: ActionHandler? = null

    // ── Configuration ────────────────────────────────────────

    fun setNativeSender(sender: NativeNotificationSender) {
        nativeSender = sender
    }

    fun setOverlaySender(sender: OverlayNotificationSender) {
        overlaySender = sender
    }

    fun setActionHandler(handler: ActionHandler) {
        actionHandler = handler
    }

    fun updateSettings(newSettings: NotificationSettings) {
        settings = newSettings
    }

    fun getSettings(): NotificationSettings = settings

    // ── Core ─────────────────────────────────────────────────

    /**
     * Send a notification through configured channels.
     * Respects throttling and per-type/per-channel settings.
     */
    fun notify(notification: Notification): NotifyResult {
        // Check throttling
        if (shouldThrottle(notification.type)) {
            return NotifyResult(throttled = true)
        }

        var nativeSent = false
        var overlaySent = false

        // Native channel
        if (isEnabled(notification.type, Channel.NATIVE)) {
            nativeSent = nativeSender?.send(notification) ?: false
        }

        // Overlay channel
        if (isEnabled(notification.type, Channel.OVERLAY)) {
            overlaySent = overlaySender?.send(notification) ?: false
        }

        // Record
        if (nativeSent || overlaySent) {
            recordNotification(notification.type)
        }

        return NotifyResult(
            throttled = false,
            nativeSent = nativeSent,
            overlaySent = overlaySent
        )
    }

    /** Handle a notification action callback */
    fun handleAction(notificationId: String, action: String) {
        actionHandler?.handle(notificationId, action)
    }

    // ── Helpers ──────────────────────────────────────────────

    private enum class Channel { NATIVE, OVERLAY }

    private fun shouldThrottle(type: NotificationType): Boolean {
        val now = System.currentTimeMillis()

        // Clean old entries
        recentTimestamps.removeAll { now - it >= 60_000 }

        // Global rate limit
        if (recentTimestamps.size >= settings.throttling.maxPerMinute) {
            return true
        }

        // Per-type cooldown
        val lastTime = lastNotifications[type] ?: 0
        val cooldown = when (type) {
            NotificationType.SUSPICIOUS_RPC,
            NotificationType.RPC_BLOCKED -> settings.throttling.rpcActivityCooldownMs
            NotificationType.PROXY_ERROR -> settings.throttling.proxyErrorCooldownMs
            else -> 0L
        }

        return cooldown > 0 && now - lastTime < cooldown
    }

    private fun recordNotification(type: NotificationType) {
        val now = System.currentTimeMillis()
        lastNotifications[type] = now
        recentTimestamps.add(now)
    }

    private fun isEnabled(type: NotificationType, channel: Channel): Boolean {
        return when (channel) {
            Channel.NATIVE -> {
                if (!settings.nativeEnabled || !type.supportsNative) return false
                when (type) {
                    NotificationType.TOR_CONNECTED -> settings.native.torConnected
                    NotificationType.TOR_DISCONNECTED -> settings.native.torDisconnected
                    NotificationType.PROXY_ERROR -> settings.native.proxyError
                    NotificationType.PROTECTION_ON,
                    NotificationType.PROTECTION_OFF -> settings.native.protectionStatusChange
                    NotificationType.SUSPICIOUS_RPC -> settings.native.suspiciousActivity
                    NotificationType.EXT_WARNING -> settings.native.extensionWarning
                    else -> true
                }
            }
            Channel.OVERLAY -> {
                if (!settings.overlayEnabled || !type.supportsOverlay) return false
                when (type) {
                    NotificationType.PROXY_ERROR,
                    NotificationType.PROTECTION_OFF,
                    NotificationType.SUSPICIOUS_RPC -> settings.overlay.securityWarnings
                    NotificationType.RPC_BLOCKED -> settings.overlay.rpcBlocked
                    NotificationType.EXT_WARNING -> settings.overlay.suspiciousExtension
                    NotificationType.UNPROTECTED_DAPP -> settings.overlay.unprotectedWarning
                    else -> true
                }
            }
        }
    }
}
