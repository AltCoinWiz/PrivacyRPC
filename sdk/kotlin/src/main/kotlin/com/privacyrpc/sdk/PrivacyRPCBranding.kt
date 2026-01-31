package com.privacyrpc.sdk

/**
 * PrivacyRPC Branding Constants
 *
 * Official brand colors, version info, and theming constants
 * matching the PrivacyRPC Chrome Extension and Demo UI.
 */
object PrivacyRPCBranding {

    // ── App Identity ──────────────────────────────────────────
    const val NAME = "PrivacyRPC"
    const val VERSION = "2.0.0"
    const val DESCRIPTION = "Privacy-First Solana RPC Protection"
    const val TAGLINE = "Privacy-first Solana RPC protection"

    // ── Brand Colors (Hex) ────────────────────────────────────
    object Colors {
        /** Primary accent – cyan/teal */
        const val PRIMARY = "#5AF5F5"
        /** Primary hover */
        const val PRIMARY_HOVER = "#7FF7F7"
        /** Primary background tint */
        const val PRIMARY_BG = "#0A1A1A"
        /** Primary dark tint */
        const val PRIMARY_DARK = "#0D3D3D"
        /** Primary border */
        const val PRIMARY_BORDER = "#1E4040"

        /** Warning – amber */
        const val WARNING = "#FFB800"
        /** Warning background tint */
        const val WARNING_BG = "#1A1508"
        /** Warning border */
        const val WARNING_BORDER = "#3D3A0A"

        /** Danger – red */
        const val DANGER = "#FF4757"
        /** Danger background tint */
        const val DANGER_BG = "#1A0A0A"
        /** Danger border */
        const val DANGER_BORDER = "#3D1A1A"

        /** Background – pure black */
        const val BACKGROUND = "#000000"
        /** Card / surface */
        const val SURFACE = "#050505"
        /** Border / separator */
        const val BORDER = "#1E2328"
        /** Secondary surface */
        const val SURFACE_SECONDARY = "#2A3038"

        /** Text – white */
        const val TEXT_PRIMARY = "#FFFFFF"
        /** Muted text */
        const val TEXT_MUTED = "#7D7D7D"
        /** Secondary text */
        const val TEXT_SECONDARY = "#AAAAAA"
    }

    // ── Brand Colors (ARGB Int for Android) ──────────────────
    object ColorsInt {
        const val PRIMARY: Long          = 0xFF5AF5F5
        const val PRIMARY_HOVER: Long    = 0xFF7FF7F7
        const val PRIMARY_BG: Long       = 0xFF0A1A1A
        const val PRIMARY_DARK: Long     = 0xFF0D3D3D
        const val PRIMARY_BORDER: Long   = 0xFF1E4040

        const val WARNING: Long          = 0xFFFFB800
        const val WARNING_BG: Long       = 0xFF1A1508
        const val WARNING_BORDER: Long   = 0xFF3D3A0A

        const val DANGER: Long           = 0xFFFF4757
        const val DANGER_BG: Long        = 0xFF1A0A0A
        const val DANGER_BORDER: Long    = 0xFF3D1A1A

        const val BACKGROUND: Long       = 0xFF000000
        const val SURFACE: Long          = 0xFF050505
        const val BORDER: Long           = 0xFF1E2328
        const val SURFACE_SECONDARY: Long = 0xFF2A3038

        const val TEXT_PRIMARY: Long     = 0xFFFFFFFF
        const val TEXT_MUTED: Long       = 0xFF7D7D7D
    }

    // ── Typography ───────────────────────────────────────────
    object Typography {
        const val FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        const val MONO_FONT = "'SF Mono', Monaco, monospace"
    }

    // ── Status Labels ────────────────────────────────────────
    object Status {
        const val ACTIVE = "Active"
        const val INACTIVE = "Inactive"
        const val PROTECTED = "Protected"
        const val PROXY_OFFLINE = "Proxy Offline"
        const val TOR_ACTIVE = "Tor Active"
        const val PUBLIC_RPC = "Public RPC"
        const val CONNECTING = "Connecting..."
    }
}
