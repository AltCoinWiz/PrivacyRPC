/**
 * ZK Compression Module for PrivacyRPC
 *
 * Integrates Solana ZK Compression for enhanced privacy and reduced costs.
 * Works with Helius and other ZK Compression-enabled RPC providers.
 *
 * @see https://www.zkcompression.com/
 */

export interface CompressedAccount {
  hash: string;
  address?: string;
  owner: string;
  lamports: number;
  data: {
    discriminator: number;
    data: string;
    dataHash: string;
  };
  slotCreated: number;
}

export interface ValidityProof {
  compressedProof: {
    a: string;
    b: string;
    c: string;
  };
  roots: string[];
  rootIndices: number[];
  leafIndices: number[];
  leaves: string[];
  merkleTrees: string[];
  nullifierQueues: string[];
}

export interface ZKCompressionConfig {
  heliusApiKey?: string;
  cacheProofs?: boolean;
  cacheTTL?: number; // milliseconds
  autoCompressThreshold?: number; // lamports - auto-suggest compression above this
}

// ZK Compression RPC methods
const ZK_METHODS = [
  'getCompressedAccount',
  'getCompressedAccountsByOwner',
  'getCompressedBalance',
  'getCompressedBalanceByOwner',
  'getCompressedTokenAccountBalance',
  'getCompressedTokenAccountsByOwner',
  'getCompressedTokenAccountsByDelegate',
  'getCompressedTokenBalancesByOwner',
  'getCompressedMintTokenHolders',
  'getCompressionSignaturesForAccount',
  'getCompressionSignaturesForAddress',
  'getCompressionSignaturesForOwner',
  'getCompressionSignaturesForTokenOwner',
  'getLatestCompressionSignatures',
  'getLatestNonVotingSignatures',
  'getTransactionWithCompressionInfo',
  'getMultipleCompressedAccounts',
  'getMultipleNewAddressProofs',
  'getValidityProof',
  'getIndexerHealth',
  'getIndexerSlot'
];

export class ZKCompression {
  private config: ZKCompressionConfig;
  private proofCache: Map<string, { proof: ValidityProof; expires: number }>;
  private stats: {
    compressedCalls: number;
    regularCalls: number;
    proofsCached: number;
    cacheHits: number;
    estimatedSavings: number; // in lamports
  };

  constructor(config: ZKCompressionConfig = {}) {
    this.config = {
      cacheProofs: true,
      cacheTTL: 60000, // 1 minute default
      autoCompressThreshold: 10000, // 0.00001 SOL
      ...config
    };
    this.proofCache = new Map();
    this.stats = {
      compressedCalls: 0,
      regularCalls: 0,
      proofsCached: 0,
      cacheHits: 0,
      estimatedSavings: 0
    };
  }

  /**
   * Check if an RPC method is a ZK Compression method
   */
  isZKMethod(method: string): boolean {
    return ZK_METHODS.includes(method);
  }

  /**
   * Get the appropriate RPC endpoint for ZK Compression
   * Helius requires specific endpoints for ZK methods
   */
  getZKEndpoint(baseEndpoint: string): string {
    // Helius ZK Compression uses the same endpoint but requires API key
    if (baseEndpoint.includes('helius')) {
      return baseEndpoint;
    }
    // For other providers, might need to append /zk or similar
    return baseEndpoint;
  }

  /**
   * Intercept and enhance RPC request with ZK Compression
   */
  async processRequest(request: any, _rpcEndpoint: string): Promise<any> {
    const method = request.method;

    if (this.isZKMethod(method)) {
      this.stats.compressedCalls++;

      // Check proof cache for validity proof requests
      if (method === 'getValidityProof' && this.config.cacheProofs) {
        const cacheKey = this.getCacheKey(request.params);
        const cached = this.proofCache.get(cacheKey);

        if (cached && cached.expires > Date.now()) {
          this.stats.cacheHits++;
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: cached.proof
          };
        }
      }
    } else {
      this.stats.regularCalls++;
    }

    return null; // Let the proxy handle the actual request
  }

  /**
   * Process response and cache if needed
   */
  processResponse(request: any, response: any): void {
    if (request.method === 'getValidityProof' && this.config.cacheProofs && response.result) {
      const cacheKey = this.getCacheKey(request.params);
      this.proofCache.set(cacheKey, {
        proof: response.result,
        expires: Date.now() + (this.config.cacheTTL || 60000)
      });
      this.stats.proofsCached++;
    }

    // Estimate savings for compressed account operations
    if (this.isZKMethod(request.method)) {
      // Compressed accounts typically save ~100x on rent
      this.stats.estimatedSavings += 1000; // rough estimate per call
    }
  }

  /**
   * Generate cache key from request params
   */
  private getCacheKey(params: any): string {
    return JSON.stringify(params);
  }

  /**
   * Get compressed account info
   */
  async getCompressedAccount(
    rpcEndpoint: string,
    addressOrHash: string
  ): Promise<CompressedAccount | null> {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getCompressedAccount',
        params: { address: addressOrHash }
      })
    });

    const data: any = await response.json();
    return data.result?.value || null;
  }

  /**
   * Get all compressed accounts for an owner
   */
  async getCompressedAccountsByOwner(
    rpcEndpoint: string,
    owner: string
  ): Promise<CompressedAccount[]> {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getCompressedAccountsByOwner',
        params: { owner }
      })
    });

    const data: any = await response.json();
    return data.result?.value?.items || [];
  }

  /**
   * Get validity proof for compressed accounts
   * Required for transactions involving compressed state
   */
  async getValidityProof(
    rpcEndpoint: string,
    hashes: string[],
    newAddresses?: string[]
  ): Promise<ValidityProof | null> {
    // Check cache first
    const cacheKey = this.getCacheKey({ hashes, newAddresses });
    const cached = this.proofCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      this.stats.cacheHits++;
      return cached.proof;
    }

    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getValidityProof',
        params: {
          hashes,
          newAddresses: newAddresses || []
        }
      })
    });

    const data: any = await response.json();
    const proof = data.result?.value || null;

    // Cache the proof
    if (proof && this.config.cacheProofs) {
      this.proofCache.set(cacheKey, {
        proof,
        expires: Date.now() + (this.config.cacheTTL || 60000)
      });
      this.stats.proofsCached++;
    }

    return proof;
  }

  /**
   * Check if an address has compressed accounts
   */
  async hasCompressedAccounts(
    rpcEndpoint: string,
    owner: string
  ): Promise<boolean> {
    const accounts = await this.getCompressedAccountsByOwner(rpcEndpoint, owner);
    return accounts.length > 0;
  }

  /**
   * Get total compressed balance for owner
   */
  async getCompressedBalanceByOwner(
    rpcEndpoint: string,
    owner: string
  ): Promise<number> {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getCompressedBalanceByOwner',
        params: { owner }
      })
    });

    const data: any = await response.json();
    return data.result?.value || 0;
  }

  /**
   * Get compression statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.proofCache.size,
      compressionRatio: this.stats.compressedCalls /
        (this.stats.compressedCalls + this.stats.regularCalls) || 0
    };
  }

  /**
   * Clear proof cache
   */
  clearCache(): void {
    this.proofCache.clear();
  }

  /**
   * Clean expired cache entries
   */
  cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of this.proofCache.entries()) {
      if (value.expires < now) {
        this.proofCache.delete(key);
      }
    }
  }
}

export default ZKCompression;
