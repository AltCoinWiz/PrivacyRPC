import Foundation

/// dApp & Wallet Detector for PrivacyRPC
///
/// Detects known Solana dApps and crypto wallets.
/// Matches the Chrome extension's detection databases.
public class DAppDetector {

    // MARK: - Models

    public struct DAppInfo {
        public let hostname: String
        public let name: String
        public let category: DAppCategory
        public let isTrusted: Bool

        public init(hostname: String, name: String, category: DAppCategory, isTrusted: Bool = true) {
            self.hostname = hostname
            self.name = name
            self.category = category
            self.isTrusted = isTrusted
        }
    }

    public enum DAppCategory: String {
        case dex = "DEX"
        case lending = "LENDING"
        case nft = "NFT"
        case wallet = "WALLET"
        case explorer = "EXPLORER"
        case infrastructure = "INFRASTRUCTURE"
        case bridge = "BRIDGE"
        case governance = "GOVERNANCE"
        case other = "OTHER"
    }

    public struct WalletInfo {
        public let id: String
        public let name: String
    }

    public struct SiteAnalysis {
        public let hostname: String
        public let isDApp: Bool
        public let dAppInfo: DAppInfo?
        public let isWalletSite: Bool
        public let category: DAppCategory?
    }

    // MARK: - Known Solana dApps (matching extension popup.js)

    public static let knownDApps: [String: DAppInfo] = {
        var dapps: [String: DAppInfo] = [:]
        let entries: [(String, String, DAppCategory)] = [
            // DEXs
            ("jup.ag", "Jupiter", .dex),
            ("jupiter.ag", "Jupiter", .dex),
            ("raydium.io", "Raydium", .dex),
            ("orca.so", "Orca", .dex),
            ("lifinity.io", "Lifinity", .dex),
            ("meteora.ag", "Meteora", .dex),
            ("phoenix.trade", "Phoenix", .dex),
            ("drift.trade", "Drift", .dex),
            ("zeta.markets", "Zeta Markets", .dex),

            // Lending / DeFi
            ("marinade.finance", "Marinade", .lending),
            ("solend.fi", "Solend", .lending),
            ("mango.markets", "Mango Markets", .lending),
            ("kamino.finance", "Kamino", .lending),
            ("marginfi.com", "marginfi", .lending),
            ("solblaze.org", "SolBlaze", .lending),
            ("jito.network", "Jito", .lending),

            // NFT Marketplaces
            ("magiceden.io", "Magic Eden", .nft),
            ("tensor.trade", "Tensor", .nft),
            ("hyperspace.xyz", "Hyperspace", .nft),
            ("exchange.art", "Exchange Art", .nft),
            ("formfunction.xyz", "Formfunction", .nft),
            ("solanart.io", "Solanart", .nft),
            ("opensea.io", "OpenSea", .nft),

            // Wallets
            ("phantom.app", "Phantom", .wallet),
            ("solflare.com", "Solflare", .wallet),
            ("backpack.app", "Backpack", .wallet),
            ("glow.app", "Glow", .wallet),

            // Explorers
            ("solana.com", "Solana", .explorer),
            ("solscan.io", "Solscan", .explorer),
            ("solanabeach.io", "Solana Beach", .explorer),
            ("explorer.solana.com", "Solana Explorer", .explorer),
            ("xray.helius.xyz", "XRAY", .explorer),
            ("solana.fm", "SolanaFM", .explorer),

            // Infrastructure
            ("squads.so", "Squads", .governance),
            ("realms.today", "Realms", .governance),
            ("dialect.to", "Dialect", .infrastructure),
            ("helius.dev", "Helius", .infrastructure),
            ("shyft.to", "Shyft", .infrastructure),
            ("quicknode.com", "QuickNode", .infrastructure),
            ("alchemy.com", "Alchemy", .infrastructure)
        ]

        for (host, name, cat) in entries {
            dapps[host] = DAppInfo(hostname: host, name: name, category: cat)
        }
        return dapps
    }()

    // MARK: - Known Wallet Extension IDs (matching extension background.js)

    public static let knownWallets: [String: WalletInfo] = [
        "bfnaelmomeimhlpmgjnjophhpkkoljpa": WalletInfo(id: "bfnaelmomeimhlpmgjnjophhpkkoljpa", name: "Phantom"),
        "gojhcdgcpbpfigcaejpfhfegekdlneif": WalletInfo(id: "gojhcdgcpbpfigcaejpfhfegekdlneif", name: "Phantom (Dev)"),
        "aflkmfhebedbjioipglgcbcmnbpgliof": WalletInfo(id: "aflkmfhebedbjioipglgcbcmnbpgliof", name: "Backpack"),
        "jnlgamecbpmbajjfhmmmlhejkemejdma": WalletInfo(id: "jnlgamecbpmbajjfhmmmlhejkemejdma", name: "Backpack"),
        "bhhhlbepdkbapadjdnnojkbgioiodbic": WalletInfo(id: "bhhhlbepdkbapadjdnnojkbgioiodbic", name: "Solflare"),
        "nkbihfbeogaeaoehlefnkodbefgpgknn": WalletInfo(id: "nkbihfbeogaeaoehlefnkodbefgpgknn", name: "MetaMask"),
        "ejbalbakoplchlghecdalmeeeajnimhm": WalletInfo(id: "ejbalbakoplchlghecdalmeeeajnimhm", name: "MetaMask (Edge)"),
        "mcohilncbfahbmgdjkbpemcciiolgcge": WalletInfo(id: "mcohilncbfahbmgdjkbpemcciiolgcge", name: "OKX Wallet"),
        "fhbohimaelbohpjbbldcngcnapndodjp": WalletInfo(id: "fhbohimaelbohpjbbldcngcnapndodjp", name: "Binance Wallet"),
        "cfadjkfokiepapnlpbpdmaeajnhheghf": WalletInfo(id: "cfadjkfokiepapnlpbpdmaeajnhheghf", name: "Glow"),
        "dlcobpjiigpikoobohmabehhmhfoodbb": WalletInfo(id: "dlcobpjiigpikoobohmabehhmhfoodbb", name: "Coinbase Wallet"),
        "hnfanknocfeofbddgcijnmhnfnkdnaad": WalletInfo(id: "hnfanknocfeofbddgcijnmhnfnkdnaad", name: "Coinbase Wallet (Dev)"),
        "pocmplpaccanhmnllbbkpgfliimjljgo": WalletInfo(id: "pocmplpaccanhmnllbbkpgfliimjljgo", name: "Slope"),
        "ibnejdfjmmkpcnlpebklmnkoeoihofec": WalletInfo(id: "ibnejdfjmmkpcnlpebklmnkoeoihofec", name: "Trust Wallet"),
        "egjidjbpglichdcondbcbdnbeeppgdph": WalletInfo(id: "egjidjbpglichdcondbcbdnbeeppgdph", name: "Trust Wallet"),
        "aholpfdialjgjfhomihkjbmgjidlcdno": WalletInfo(id: "aholpfdialjgjfhomihkjbmgjidlcdno", name: "Exodus"),
        "acmacodkjbdgmoleebolmdjonilkdbch": WalletInfo(id: "acmacodkjbdgmoleebolmdjonilkdbch", name: "Rabby Wallet"),
        "dmkamcknogkgcdfhhbddcghachkejeap": WalletInfo(id: "dmkamcknogkgcdfhhbddcghachkejeap", name: "Keplr"),
        "fcfcfllfndlomdhbehjjcoimbgofdncg": WalletInfo(id: "fcfcfllfndlomdhbehjjcoimbgofdncg", name: "Leap Wallet"),
        "mkpegjkblkkefacfnmkajcjmabijhclg": WalletInfo(id: "mkpegjkblkkefacfnmkajcjmabijhclg", name: "Magic Eden Wallet"),
        "gfkepgoophebjcgfkfgjbdkfgfcndbag": WalletInfo(id: "gfkepgoophebjcgfkfgjbdkfgfcndbag", name: "TipLink Wallet")
    ]

    // MARK: - Trusted RPC Endpoints

    public static let trustedRpcEndpoints: [String] = [
        "api.mainnet-beta.solana.com",
        "api.devnet.solana.com",
        "api.testnet.solana.com",
        "solana-api.projectserum.com",
        "rpc.helius.xyz",
        "mainnet.helius-rpc.com",
        "solana-mainnet.g.alchemy.com",
        "solana-mainnet.quiknode.pro",
        "ssc-dao.genesysgo.net"
    ]

    private static let walletKeywords = [
        "wallet", "phantom", "solana", "crypto", "backpack",
        "solflare", "metamask", "coinbase", "trust", "ledger",
        "trezor", "defi", "ethereum", "web3"
    ]

    public init() {}

    // MARK: - Detection Methods

    /// Check if a hostname belongs to a known dApp
    public func isDApp(_ hostname: String) -> Bool {
        return Self.knownDApps.contains { hostname.contains($0.key) }
    }

    /// Get dApp info for a hostname
    public func getDAppInfo(_ hostname: String) -> DAppInfo? {
        return Self.knownDApps.first { hostname.contains($0.key) }?.value
    }

    /// Analyze a site and return structured info
    public func analyzeSite(_ hostname: String) -> SiteAnalysis {
        let dAppInfo = getDAppInfo(hostname)
        return SiteAnalysis(
            hostname: hostname,
            isDApp: dAppInfo != nil,
            dAppInfo: dAppInfo,
            isWalletSite: dAppInfo?.category == .wallet,
            category: dAppInfo?.category
        )
    }

    /// Check if a wallet extension ID is known
    public func isKnownWallet(_ extensionId: String) -> Bool {
        return Self.knownWallets[extensionId] != nil
    }

    /// Get wallet info by extension ID
    public func getWalletInfo(_ extensionId: String) -> WalletInfo? {
        return Self.knownWallets[extensionId]
    }

    /// Check if a name looks like a wallet extension
    public func isWalletByName(_ name: String) -> Bool {
        let lower = name.lowercased()
        return Self.walletKeywords.contains { lower.contains($0) }
    }

    /// Check if an RPC endpoint is trusted
    public func isTrustedEndpoint(_ url: String) -> Bool {
        return Self.trustedRpcEndpoints.contains { url.contains($0) }
    }
}
