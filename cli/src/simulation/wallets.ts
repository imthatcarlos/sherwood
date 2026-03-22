/**
 * HD wallet derivation from BIP-39 mnemonic.
 *
 * Uses BIP-44 path: m/44'/60'/0'/0/i
 * Index 0 = master wallet (holds ETH + USDC for funding)
 * Indices 1-N = agent wallets
 */

import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { privateKeyToAccount } from "viem/accounts";

export interface DerivedWallet {
  index: number;
  address: string;
  privateKey: `0x${string}`;
}

/**
 * Validate and derive wallets from a BIP-39 mnemonic.
 * Returns `count` wallets starting from index 0.
 * Index 0 is the master/funding wallet.
 */
export function deriveWallets(mnemonic: string, count: number): DerivedWallet[] {
  // Validate mnemonic word count (12 or 24 words)
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(`Invalid mnemonic: expected 12 or 24 words, got ${words.length}`);
  }

  const seed = mnemonicToSeedSync(mnemonic, undefined);
  const master = HDKey.fromMasterSeed(seed);

  return Array.from({ length: count }, (_, i) => {
    const child = master.derive(`m/44'/60'/0'/0/${i}`);
    if (!child.privateKey) {
      throw new Error(`Failed to derive private key for index ${i}`);
    }
    const privateKey = `0x${Buffer.from(child.privateKey).toString("hex")}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    return { index: i, address: account.address, privateKey };
  });
}

/**
 * Derive a single wallet at the given index.
 */
export function deriveWallet(mnemonic: string, index: number): DerivedWallet {
  const seed = mnemonicToSeedSync(mnemonic, undefined);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(`m/44'/60'/0'/0/${index}`);
  if (!child.privateKey) {
    throw new Error(`Failed to derive private key for index ${index}`);
  }
  const privateKey = `0x${Buffer.from(child.privateKey).toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return { index, address: account.address, privateKey };
}
