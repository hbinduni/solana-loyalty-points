import { isIP } from "node:net";
import {
  createV1,
  type Metadata,
  mplTokenMetadata,
  TokenStandard,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  isSome,
  none,
  type PublicKey,
  percentAmount,
  publicKey,
  some,
  type Umi,
} from "@metaplex-foundation/umi";
import { publicKey as publicKeySerializer } from "@metaplex-foundation/umi/serializers";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

export const TOKEN_PROGRAM = publicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const NAME = "Orbit Points";
export const SYMBOL = "ORBIT";

export function createMetadataClient(endpoint: string) {
  // Umi 1.5.1 drops the per-call simulation commitment. Keep its connection
  // aligned with getLatestBlockhash until the request-level regression passes without this default.
  return createUmi(endpoint, { commitment: "confirmed" }).use(
    mplTokenMetadata(),
  );
}

export function validateMint(
  genesis: string,
  owner: PublicKey,
  data: Uint8Array,
  authority: PublicKey,
): void {
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("Only Solana Devnet is allowed");
  if (owner !== TOKEN_PROGRAM)
    throw new Error("Expected Token-2022 mint owner");
  // Match the narrow mint layout accepted by the Go API. Metadata lives in a separate PDA.
  if (
    data.length !== 170 ||
    data[44] !== 0 ||
    data[45] !== 1 ||
    data.slice(46, 165).some(Boolean) ||
    data[165] !== 1 ||
    data[166] !== 9 ||
    data.slice(167).some(Boolean)
  ) {
    throw new Error(
      "Expected initialized non-transferable mint with zero decimals and no freeze authority or extra extensions",
    );
  }
  const option = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getUint32(0, true);
  const [mintAuthority] = publicKeySerializer().deserialize(data.slice(4, 36));
  if (option !== 1 || mintAuthority !== authority)
    throw new Error("Configured keypair is not the mint authority");
}

export function validatePublicURI(uri: string): URL {
  const url = new URL(uri);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".local") ||
    isIP(url.hostname.replace(/^\[|\]$/g, ""))
  ) {
    throw new Error(
      "Metadata URI must use a public HTTPS hostname without credentials or a fragment",
    );
  }
  return url;
}

export function metadataChange(
  umi: Umi,
  mint: PublicKey,
  uri: string,
  existing: Metadata | null,
) {
  validatePublicURI(uri);
  if (new TextEncoder().encode(uri).length > 200)
    throw new Error("Metadata URI exceeds 200 bytes");
  if (!existing) {
    return createV1(umi, {
      mint,
      splTokenProgram: TOKEN_PROGRAM,
      name: NAME,
      symbol: SYMBOL,
      uri,
      sellerFeeBasisPoints: percentAmount(0),
      tokenStandard: TokenStandard.Fungible,
      isMutable: true,
      decimals: 0,
      creators: none(),
    });
  }
  if (
    existing.mint !== mint ||
    existing.updateAuthority !== umi.identity.publicKey ||
    !existing.isMutable ||
    !isSome(existing.tokenStandard) ||
    existing.tokenStandard.value !== TokenStandard.Fungible
  ) {
    throw new Error(
      "Existing metadata must be mutable, fungible, and owned by the configured authority for this mint",
    );
  }
  if (
    existing.name === NAME &&
    existing.symbol === SYMBOL &&
    existing.uri === uri
  )
    return null;
  return updateV1(umi, {
    mint,
    data: some({
      name: NAME,
      symbol: SYMBOL,
      uri,
      sellerFeeBasisPoints: existing.sellerFeeBasisPoints,
      creators: existing.creators,
    }),
  });
}
