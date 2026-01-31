import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// PrivacyRPC Branding Constants
///
/// Official brand colors, version info, and theming constants
/// matching the PrivacyRPC Chrome Extension and Demo UI.
public enum PrivacyRPCBranding {

    // MARK: - App Identity

    public static let name = "PrivacyRPC"
    public static let version = "2.0.0"
    public static let description = "Privacy-First Solana RPC Protection"
    public static let tagline = "Privacy-first Solana RPC protection"

    // MARK: - Brand Colors (Hex Strings)

    public enum ColorHex {
        /// Primary accent – cyan/teal
        public static let primary = "#5AF5F5"
        public static let primaryHover = "#7FF7F7"
        public static let primaryBg = "#0A1A1A"
        public static let primaryDark = "#0D3D3D"
        public static let primaryBorder = "#1E4040"

        /// Warning – amber
        public static let warning = "#FFB800"
        public static let warningBg = "#1A1508"
        public static let warningBorder = "#3D3A0A"

        /// Danger – red
        public static let danger = "#FF4757"
        public static let dangerBg = "#1A0A0A"
        public static let dangerBorder = "#3D1A1A"

        /// Backgrounds
        public static let background = "#000000"
        public static let surface = "#050505"
        public static let border = "#1E2328"
        public static let surfaceSecondary = "#2A3038"

        /// Text
        public static let textPrimary = "#FFFFFF"
        public static let textMuted = "#7D7D7D"
        public static let textSecondary = "#AAAAAA"
    }

    // MARK: - Native Colors

    #if canImport(UIKit)
    public enum Colors {
        public static let primary        = UIColor(red: 0.353, green: 0.961, blue: 0.961, alpha: 1)
        public static let primaryHover   = UIColor(red: 0.498, green: 0.969, blue: 0.969, alpha: 1)
        public static let primaryBg      = UIColor(red: 0.039, green: 0.102, blue: 0.102, alpha: 1)
        public static let primaryDark    = UIColor(red: 0.051, green: 0.239, blue: 0.239, alpha: 1)
        public static let primaryBorder  = UIColor(red: 0.118, green: 0.251, blue: 0.251, alpha: 1)

        public static let warning        = UIColor(red: 1.0, green: 0.722, blue: 0.0, alpha: 1)
        public static let warningBg      = UIColor(red: 0.102, green: 0.082, blue: 0.031, alpha: 1)
        public static let warningBorder  = UIColor(red: 0.239, green: 0.227, blue: 0.039, alpha: 1)

        public static let danger         = UIColor(red: 1.0, green: 0.278, blue: 0.341, alpha: 1)
        public static let dangerBg       = UIColor(red: 0.102, green: 0.039, blue: 0.039, alpha: 1)
        public static let dangerBorder   = UIColor(red: 0.239, green: 0.102, blue: 0.102, alpha: 1)

        public static let background     = UIColor(red: 0, green: 0, blue: 0, alpha: 1)
        public static let surface        = UIColor(red: 0.02, green: 0.02, blue: 0.02, alpha: 1)
        public static let border         = UIColor(red: 0.118, green: 0.137, blue: 0.157, alpha: 1)

        public static let textPrimary    = UIColor.white
        public static let textMuted      = UIColor(red: 0.49, green: 0.49, blue: 0.49, alpha: 1)
    }
    #elseif canImport(AppKit)
    public enum Colors {
        public static let primary        = NSColor(red: 0.353, green: 0.961, blue: 0.961, alpha: 1)
        public static let primaryHover   = NSColor(red: 0.498, green: 0.969, blue: 0.969, alpha: 1)
        public static let primaryBg      = NSColor(red: 0.039, green: 0.102, blue: 0.102, alpha: 1)
        public static let primaryDark    = NSColor(red: 0.051, green: 0.239, blue: 0.239, alpha: 1)
        public static let primaryBorder  = NSColor(red: 0.118, green: 0.251, blue: 0.251, alpha: 1)

        public static let warning        = NSColor(red: 1.0, green: 0.722, blue: 0.0, alpha: 1)
        public static let warningBg      = NSColor(red: 0.102, green: 0.082, blue: 0.031, alpha: 1)
        public static let warningBorder  = NSColor(red: 0.239, green: 0.227, blue: 0.039, alpha: 1)

        public static let danger         = NSColor(red: 1.0, green: 0.278, blue: 0.341, alpha: 1)
        public static let dangerBg       = NSColor(red: 0.102, green: 0.039, blue: 0.039, alpha: 1)
        public static let dangerBorder   = NSColor(red: 0.239, green: 0.102, blue: 0.102, alpha: 1)

        public static let background     = NSColor(red: 0, green: 0, blue: 0, alpha: 1)
        public static let surface        = NSColor(red: 0.02, green: 0.02, blue: 0.02, alpha: 1)
        public static let border         = NSColor(red: 0.118, green: 0.137, blue: 0.157, alpha: 1)

        public static let textPrimary    = NSColor.white
        public static let textMuted      = NSColor(red: 0.49, green: 0.49, blue: 0.49, alpha: 1)
    }
    #endif

    // MARK: - Status Labels

    public enum Status {
        public static let active = "Active"
        public static let inactive = "Inactive"
        public static let protected_ = "Protected"
        public static let proxyOffline = "Proxy Offline"
        public static let torActive = "Tor Active"
        public static let publicRpc = "Public RPC"
        public static let connecting = "Connecting..."
    }
}
