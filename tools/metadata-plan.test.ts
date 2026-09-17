import { describe, expect, test } from "bun:test";
import {
  getCreateV1InstructionDataSerializer,
  getUpdateV1InstructionDataSerializer,
  Key,
  type Metadata,
  mplTokenMetadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createNoopSigner,
  none,
  publicKey,
  signerIdentity,
  sol,
  some,
} from "@metaplex-foundation/umi";
import { publicKey as publicKeySerializer } from "@metaplex-foundation/umi/serializers";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createMetadataClient,
  metadataChange,
  validateMint,
} from "./metadata-plan";

const authority = publicKey("7twutFoPeiPAiU9rWQotRcK3J26ocv1o7FnbRf9Q8wk6");
const mint = publicKey("81NcDN9ibRWng57uABVSATcKjn2ZoajJdBANxfgR4e2i");
const program = publicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const uri =
  "https://raw.githubusercontent.com/hbinduni/solana-loyalty-points/main/client/public/token/metadata.json";
const umi = createUmi("http://localhost:8899")
  .use(mplTokenMetadata())
  .use(signerIdentity(createNoopSigner(authority)));

function mintData() {
  const bytes = new Uint8Array(170);
  bytes[0] = 1; // COption::Some mint authority.
  bytes.set(publicKeySerializer().serialize(authority), 4);
  bytes[45] = 1; // Initialized; decimals and freeze authority remain zero.
  bytes[165] = 1; // Mint account type.
  bytes[166] = 9; // NonTransferable extension with zero data length.
  return bytes;
}

function existingMetadata(): Metadata {
  return {
    publicKey: mint,
    header: {
      executable: false,
      owner: publicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
      lamports: sol(0),
    },
    key: Key.MetadataV1,
    updateAuthority: authority,
    mint,
    name: "Old name",
    symbol: "OLD",
    uri: "https://example.com/old.json",
    sellerFeeBasisPoints: 0,
    creators: none(),
    primarySaleHappened: false,
    isMutable: true,
    editionNonce: none(),
    tokenStandard: some(TokenStandard.Fungible),
    collection: none(),
    uses: none(),
    collectionDetails: none(),
    programmableConfig: none(),
  };
}

describe("Devnet mint guard", () => {
  test("accepts the existing zero-decimal non-transferable mint", () => {
    expect(() =>
      validateMint(genesis, program, mintData(), authority),
    ).not.toThrow();
  });
  test("rejects another network, authority, or token program", () => {
    expect(() =>
      validateMint("mainnet", program, mintData(), authority),
    ).toThrow("Devnet");
    expect(() => validateMint(genesis, mint, mintData(), authority)).toThrow(
      "Token-2022",
    );
    expect(() => validateMint(genesis, program, mintData(), mint)).toThrow(
      "authority",
    );
  });
  test("rejects mint layouts the app would not accept", () => {
    for (const index of [44, 46, 165, 166, 168]) {
      const bytes = mintData();
      bytes[index] = 2;
      expect(() => validateMint(genesis, program, bytes, authority)).toThrow();
    }
    expect(() =>
      validateMint(genesis, program, mintData().slice(0, 82), authority),
    ).toThrow();
  });
});

describe("metadata instructions", () => {
  test("creates fungible metadata for the existing mint without minting points", () => {
    const instructions = metadataChange(
      umi,
      mint,
      uri,
      null,
    )?.getInstructions();
    expect(instructions).toHaveLength(1);
    const ix = instructions?.[0];
    expect(ix?.programId).toBe(
      publicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    );
    expect(ix?.keys.find((key) => key.pubkey === mint)?.isSigner).toBe(false);
    expect(ix?.keys.some((key) => key.pubkey === program)).toBe(true);
    const [data] = getCreateV1InstructionDataSerializer().deserialize(
      ix?.data ?? new Uint8Array(),
    );
    expect(data.name).toBe("Orbit Points");
    expect(data.symbol).toBe("ORBIT");
    expect(data.uri).toBe(uri);
    expect(data.tokenStandard).toBe(TokenStandard.Fungible);
    expect(data.isMutable).toBe(true);
    expect(data.creators).toEqual(none());
    expect(data.sellerFeeBasisPoints.basisPoints).toBe(0n);
  });
  test("changes display fields while preserving authority and other metadata", () => {
    const previous = existingMetadata();
    const instructions = metadataChange(
      umi,
      mint,
      uri,
      previous,
    )?.getInstructions();
    expect(instructions).toHaveLength(1);
    const [data] = getUpdateV1InstructionDataSerializer().deserialize(
      instructions?.[0].data ?? new Uint8Array(),
    );
    expect(data.newUpdateAuthority).toEqual(none());
    expect(data.isMutable).toEqual(none());
    expect(data.data).toEqual(
      some({
        name: "Orbit Points",
        symbol: "ORBIT",
        uri,
        sellerFeeBasisPoints: 0,
        creators: none(),
      }),
    );
  });
  test("does not resubmit an already matching update", () => {
    const previous = {
      ...existingMetadata(),
      name: "Orbit Points",
      symbol: "ORBIT",
      uri,
    };
    expect(metadataChange(umi, mint, uri, previous)).toBeNull();
  });
  test("rejects foreign, immutable, or nonfungible metadata", () => {
    for (const change of [
      { updateAuthority: mint },
      { mint: authority },
      { isMutable: false },
      { tokenStandard: some(TokenStandard.NonFungible) },
    ]) {
      expect(() =>
        metadataChange(umi, mint, uri, { ...existingMetadata(), ...change }),
      ).toThrow();
    }
  });
  test("requires a public HTTPS metadata URI within the on-chain limit", () => {
    for (const invalid of [
      "http://localhost:5173/token.json",
      "https://user:pass@example.com/meta.json",
      "https://localhost/meta.json",
      `https://example.com/${"a".repeat(200)}`,
    ]) {
      expect(() => metadataChange(umi, mint, invalid, null)).toThrow("URI");
    }
  });
});

test("simulation sends the same commitment used for the recent blockhash", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as {
        id: number;
        params: [string, { commitment?: string }];
      };
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          context: { slot: 1 },
          value: {
            err:
              body.params[1].commitment === "confirmed"
                ? null
                : "BlockhashNotFound",
            logs: [],
            accounts: null,
          },
        },
      });
    },
  });
  try {
    const client = createMetadataClient(server.url.toString()).use(
      signerIdentity(createNoopSigner(authority)),
    );
    const tx = metadataChange(client, mint, uri, null)
      ?.setBlockhash("11111111111111111111111111111111")
      .build(client);
    if (!tx) throw new Error("Expected a metadata transaction");
    const result = await client.rpc.simulateTransaction(tx, {
      commitment: "confirmed",
    });
    expect(result.err).toBeNull();
  } finally {
    server.stop(true);
  }
});
