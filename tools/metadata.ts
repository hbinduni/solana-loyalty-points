import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  fetchMetadataFromSeeds,
  findMetadataPda,
  safeFetchMetadataFromSeeds,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import {
  createMetadataClient,
  metadataChange,
  NAME,
  SYMBOL,
  validateMint,
  validatePublicURI,
} from "./metadata-plan";

const root = resolve(import.meta.dir, "..");

async function verifyAssets(uri: string) {
  validatePublicURI(uri);
  const response = await fetch(uri, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(`Metadata URL returned HTTP ${response.status}`);
  const asset: unknown = await response.json();
  if (
    !asset ||
    typeof asset !== "object" ||
    !("name" in asset) ||
    asset.name !== NAME ||
    !("symbol" in asset) ||
    asset.symbol !== SYMBOL ||
    !("description" in asset) ||
    typeof asset.description !== "string" ||
    !asset.description.trim() ||
    !("image" in asset) ||
    typeof asset.image !== "string"
  ) {
    throw new Error(
      "Public metadata must contain Orbit Points, ORBIT, a description and an image URL",
    );
  }
  validatePublicURI(asset.image);
  const image = await fetch(asset.image, {
    signal: AbortSignal.timeout(15000),
  });
  if (!image.ok || !image.headers.get("content-type")?.startsWith("image/"))
    throw new Error(
      "Public token image is unavailable or has the wrong content type",
    );
  const imageBytes = await image.arrayBuffer();
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > 1024 * 1024)
    throw new Error("Token image must be between 1 byte and 1 MiB");
  console.log("Public metadata and image are reachable.");
}

async function main() {
  const { values } = parseArgs({
    options: {
      uri: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      "bun run metadata --uri <public HTTPS metadata.json> [--apply]\nWithout --apply, validate and simulate only. Uses server/.env and the existing mint authority.",
    );
    return;
  }
  const uri = values.uri;
  const mintAddress = process.env.SOLANA_MINT;
  const authorityPath = process.env.SOLANA_AUTHORITY_KEYPAIR;
  const endpoint = process.env.SOLANA_RPC_URL;
  if (!uri || !mintAddress || !authorityPath || !endpoint)
    throw new Error(
      "--uri, SOLANA_MINT, SOLANA_AUTHORITY_KEYPAIR and SOLANA_RPC_URL are required",
    );
  if (new URL(endpoint).protocol !== "https:")
    throw new Error("Solana RPC must use HTTPS");
  await verifyAssets(uri);
  const umi = createMetadataClient(endpoint);
  const genesis = await umi.rpc.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("Only Solana Devnet is allowed");
  const raw: unknown = JSON.parse(
    await readFile(resolve(root, "server", authorityPath), "utf8"),
  );
  if (
    !Array.isArray(raw) ||
    raw.length !== 64 ||
    !raw.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  )
    throw new Error("Invalid authority keypair file");
  umi.use(
    signerIdentity(
      createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(raw)),
      ),
    ),
  );
  const mint = publicKey(mintAddress);
  const before = await umi.rpc.getAccount(mint, { commitment: "finalized" });
  if (!before.exists)
    throw new Error(
      "Configured mint does not exist; this command never creates a mint",
    );
  validateMint(genesis, before.owner, before.data, umi.identity.publicKey);
  const existing = await safeFetchMetadataFromSeeds(
    umi,
    { mint },
    { commitment: "finalized" },
  );
  const change = metadataChange(umi, mint, uri, existing);
  const metadataAddress = findMetadataPda(umi, { mint })[0];
  console.log(
    JSON.stringify(
      {
        network: "devnet",
        mint,
        metadataAddress,
        name: NAME,
        symbol: SYMBOL,
        uri,
        action: change
          ? existing
            ? "update metadata"
            : "create metadata"
          : "already current",
      },
      null,
      2,
    ),
  );
  if (!change) return;
  const blockhash = await umi.rpc.getLatestBlockhash({
    commitment: "confirmed",
  });
  const tx = await change
    .useLegacyVersion()
    .setBlockhash(blockhash)
    .buildAndSign(umi);
  const simulation = await umi.rpc.simulateTransaction(tx, {
    commitment: "confirmed",
    verifySignatures: true,
    accounts: [mint, umi.identity.publicKey],
  });
  if (simulation.err)
    throw new Error(
      `Simulation failed: ${JSON.stringify(simulation.err)}\n${simulation.logs?.join("\n")}`,
    );
  const simulatedMint = simulation.accounts?.[0];
  if (
    !simulatedMint ||
    simulatedMint.owner !== before.owner ||
    !Buffer.from(simulatedMint.data[0], "base64").equals(
      Buffer.from(before.data),
    )
  )
    throw new Error("Simulation changed mint data; refusing to send");
  console.log(
    `Simulation passed (${simulation.unitsConsumed} compute units); mint data and supply unchanged.`,
  );
  if (!values.apply) {
    console.log(
      "No transaction submitted. Run again with --apply to publish this metadata.",
    );
    return;
  }
  const signature = base58.deserialize(tx.signatures[0])[0];
  const recordPath = resolve(root, ".local", `metadata-${Date.now()}.json`);
  await mkdir(resolve(root, ".local"), { recursive: true, mode: 0o700 });
  await writeFile(
    recordPath,
    `${JSON.stringify({ mint, metadataAddress, uri, signature, blockhash, transaction: Buffer.from(umi.transactions.serialize(tx)).toString("base64") }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(`Submitting ${signature}; recovery record: ${recordPath}`);
  await umi.rpc.sendTransaction(tx, { preflightCommitment: "confirmed" });
  const confirmed = await umi.rpc.confirmTransaction(tx.signatures[0], {
    commitment: "finalized",
    strategy: { type: "blockhash", ...blockhash },
  });
  if (confirmed.value.err)
    throw new Error(
      `Metadata transaction failed: ${JSON.stringify(confirmed.value.err)}`,
    );
  const metadata = await fetchMetadataFromSeeds(
    umi,
    { mint },
    { commitment: "finalized" },
  );
  if (metadataChange(umi, mint, uri, metadata) !== null)
    throw new Error("Finalized metadata does not match the requested update");
  const after = await umi.rpc.getAccount(mint, { commitment: "finalized" });
  if (
    !after.exists ||
    after.owner !== before.owner ||
    !Buffer.from(after.data).equals(Buffer.from(before.data))
  )
    throw new Error(
      "Mint changed during metadata update; inspect before continuing",
    );
  console.log(
    `Finalized and verified. Mint data, supply and authorities unchanged.\nhttps://explorer.solana.com/tx/${signature}?cluster=devnet`,
  );
}

await main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Metadata update failed",
  );
  process.exitCode = 1;
});
