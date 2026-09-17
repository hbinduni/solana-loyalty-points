import type {
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
  StandardEventsFeature,
} from "@wallet-standard/features";
import { post } from "./api";

type Features = StandardConnectFeature &
  StandardEventsFeature &
  SolanaSignMessageFeature &
  SolanaSignTransactionFeature &
  Partial<StandardDisconnectFeature>;
export type OrbitWallet = Wallet & { features: Features };
export type Connection = { wallet: OrbitWallet; account: WalletAccount };

export const registry = getWallets();
export function availableWallets(): OrbitWallet[] {
  return registry
    .get()
    .filter(
      (wallet): wallet is OrbitWallet =>
        wallet.chains.includes("solana:devnet") &&
        [
          "standard:connect",
          "standard:events",
          "solana:signMessage",
          "solana:signTransaction",
        ].every((feature) => feature in wallet.features),
    );
}
export function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function connectWallet(wallet: OrbitWallet): Promise<Connection> {
  const { accounts } = await wallet.features["standard:connect"].connect();
  const account = accounts.find(
    (item) =>
      item.chains.includes("solana:devnet") &&
      item.features.includes("solana:signMessage") &&
      item.features.includes("solana:signTransaction"),
  );
  if (!account)
    throw new Error("Select a Solana Devnet account in your wallet.");
  if (
    !wallet.features[
      "solana:signTransaction"
    ].supportedTransactionVersions.includes("legacy")
  )
    throw new Error(
      "This wallet does not support the required transaction format.",
    );
  const challenge = await post<{ nonce: string; message: string }>(
    "/auth/challenge",
    { wallet: account.address },
  );
  const [signed] = await wallet.features["solana:signMessage"].signMessage({
    account,
    message: new TextEncoder().encode(challenge.message),
  });
  if (!signed) throw new Error("Your wallet did not return a signature.");
  await post("/auth/verify", {
    wallet: account.address,
    nonce: challenge.nonce,
    signature: encode(signed.signature),
  });
  return { wallet, account };
}

export async function signBurn(
  connection: Connection,
  transaction: string,
): Promise<string> {
  const [result] = await connection.wallet.features[
    "solana:signTransaction"
  ].signTransaction({
    account: connection.account,
    chain: "solana:devnet",
    transaction: decode(transaction),
  });
  if (!result)
    throw new Error("Your wallet did not return a signed transaction.");
  return encode(result.signedTransaction);
}
