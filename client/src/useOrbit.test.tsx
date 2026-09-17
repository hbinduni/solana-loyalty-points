import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { WalletAccount } from "@wallet-standard/base";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Operation, Reward } from "./domain";
import { useOrbit } from "./useOrbit";
import type { OrbitWallet } from "./wallet";

const reward: Reward = {
  id: "coffee",
  title: "Coffee",
  description: "Collect a coffee",
  category: "Food & drink",
  points: 250,
};
const account: WalletAccount = {
  address: "member-wallet",
  publicKey: new Uint8Array(32),
  chains: ["solana:devnet" as const],
  features: ["solana:signMessage", "solana:signTransaction"],
};
const wallet: OrbitWallet = {
  version: "1.0.0",
  name: "Test wallet",
  icon: "data:image/svg+xml;base64,",
  chains: ["solana:devnet"],
  accounts: [account],
  features: {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => ({ accounts: [account] }),
    },
    "standard:events": { version: "1.0.0", on: () => () => {} },
    "solana:signMessage": {
      version: "1.1.0",
      signMessage: async (...inputs) =>
        inputs.map(({ message }) => ({
          signedMessage: message,
          signature: new Uint8Array(64),
        })),
    },
    "solana:signTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy"],
      signTransaction: async (...inputs) =>
        inputs.map(({ transaction }) => ({ signedTransaction: transaction })),
    },
  },
};

let orbit: ReturnType<typeof useOrbit>;
let root: Root;
let container: HTMLDivElement;
let balanceStatus: number;
let activityStatus: number;
let points: string;
let omitActivity: boolean;
let lostPrepareResponse: boolean;
let operationStatus: number;
let holdBalance: boolean;
let releaseBalances: Array<(response: Response) => void>;
let expireAfterSubmit: boolean;
let holdSubmit: boolean;
let releaseSubmissions: Array<(response: Response) => void>;
let operations: Map<string, Operation>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function Harness() {
  orbit = useOrbit();
  return null;
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {
    await orbit.connect(wallet);
  });
}

async function redeem() {
  let result: Operation | null = null;
  await act(async () => {
    result = await orbit.redeem(reward);
  });
  if (!result)
    throw new Error(orbit.error || "Redemption returned no operation");
  return result as Operation;
}

async function refresh() {
  await act(async () => {
    await orbit.refresh();
  });
}

function settle(id: string, status: Operation["status"] = "confirmed") {
  for (const [key, operation] of operations) {
    if (operation.id === id) {
      operations.set(key, {
        ...operation,
        status,
        claimCode: status === "confirmed" ? `claim-${id}` : undefined,
      });
    }
  }
}

beforeEach(() => {
  localStorage.clear();
  balanceStatus = 200;
  activityStatus = 200;
  points = "1000";
  omitActivity = false;
  lostPrepareResponse = false;
  operationStatus = 200;
  holdBalance = false;
  releaseBalances = [];
  expireAfterSubmit = false;
  holdSubmit = false;
  releaseSubmissions = [];
  operations = new Map();
  const handleRequest = async (...[input, init]: Parameters<typeof fetch>) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status });
    if (url === "/api/config")
      return json({
        network: "solana:devnet",
        mint: "test-mint",
        configured: true,
        transferable: false,
      });
    if (url === "/api/rewards") return json([reward]);
    if (url === "/api/member/me") return json({ wallet: account.address });
    if (url === "/api/auth/challenge")
      return json({ nonce: "nonce", message: "Sign in to Orbit" });
    if (url === "/api/auth/verify") return json({ wallet: account.address });
    if (url === "/api/auth/logout") return new Response(null, { status: 204 });
    if (url === "/api/member/balance" && holdBalance)
      return new Promise<Response>((resolve) => releaseBalances.push(resolve));
    if (url === "/api/member/balance")
      return json(
        balanceStatus === 200 ? { points } : { error: "Balance unavailable" },
        balanceStatus,
      );
    if (url === "/api/member/activity")
      return json(
        activityStatus === 200
          ? omitActivity
            ? []
            : [...operations.values()]
          : { error: "Activity unavailable" },
        activityStatus,
      );
    if (url === "/api/member/redemptions") {
      const key = new Headers(init?.headers).get("Idempotency-Key");
      if (!key) return json({ error: "Missing idempotency key" }, 400);
      const existing = operations.get(key);
      if (existing) return json(existing);
      const operation: Operation = {
        id: crypto.randomUUID(),
        wallet: account.address,
        kind: "redeem",
        rewardId: reward.id,
        title: reward.title,
        points: reward.points,
        status: "prepared",
        transaction: btoa("burn transaction"),
        createdAt: new Date().toISOString(),
      };
      operations.set(key, operation);
      if (lostPrepareResponse) {
        lostPrepareResponse = false;
        throw new TypeError("Network interrupted after preparing redemption");
      }
      return json(operation, 201);
    }
    for (const [key, operation] of operations) {
      if (url === `/api/member/operations/${operation.id}`)
        return json(
          operationStatus === 200
            ? operation
            : { error: "Operation unavailable" },
          operationStatus,
        );
      if (url === `/api/member/operations/${operation.id}/submit`) {
        const pending: Operation = {
          ...operation,
          status: "pending",
          signature: `signature-${operation.id}`,
        };
        operations.set(key, pending);
        if (expireAfterSubmit) balanceStatus = 401;
        if (holdSubmit)
          return new Promise<Response>((resolve) =>
            releaseSubmissions.push(resolve),
          );
        return json(pending, 202);
      }
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(handleRequest, { preconnect: globalThis.fetch.preconnect }),
  );
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  fetchSpy.mockRestore();
});

describe("redemption recovery", () => {
  test("keeps signing errors visible across background refreshes until retry or dismissal", async () => {
    await mount();
    const sign = spyOn(
      wallet.features["solana:signTransaction"],
      "signTransaction",
    ).mockRejectedValueOnce(new Error("Wallet refused signing"));
    try {
      await act(async () => {
        expect(await orbit.redeem(reward)).toBeNull();
      });
      expect(orbit.error).toContain("Wallet refused signing");
      await refresh();
      expect(orbit.error).toContain("Wallet refused signing");

      balanceStatus = 503;
      await refresh();
      expect(orbit.error).toContain("Wallet refused signing");
      expect(orbit.error).toContain("Balance unavailable");
      balanceStatus = 200;
      await refresh();
      expect(orbit.error).toBe("Wallet refused signing");

      await act(async () => orbit.clearError());
      expect(orbit.error).toBe("");
      sign.mockRejectedValueOnce(new Error("Wallet refused signing"));
      await act(async () => {
        expect(await orbit.redeem(reward)).toBeNull();
      });
      const retry = await redeem();
      expect(retry.status).toBe("pending");
      expect(orbit.error).toBe("");
    } finally {
      sign.mockRestore();
    }
  });

  test("starts a new redemption after polling observes the previous success", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    await refresh();

    const next = await redeem();
    expect(next.id).not.toBe(first.id);
    expect(next.status).toBe("pending");
    expect(next.claimCode).toBeUndefined();
  });

  test("retries a pending redemption without creating another burn", async () => {
    await mount();
    const first = await redeem();
    const retry = await redeem();
    expect(retry.id).toBe(first.id);
    expect(orbit.data?.activity).toHaveLength(1);
  });

  test("recovers a completed operation after reload even outside the activity window", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    omitActivity = true;
    await act(async () => root.unmount());
    container.remove();
    await mount();

    const next = await redeem();
    expect(next.id).not.toBe(first.id);
    expect(next.status).toBe("pending");
  });

  test.each(["failed", "expired"] as const)(
    "allows a fresh attempt after polling observes %s",
    async (status) => {
      await mount();
      const first = await redeem();
      settle(first.id, status);
      await refresh();

      const next = await redeem();
      expect(next.id).not.toBe(first.id);
      expect(next.status).toBe("pending");
    },
  );

  test("an older reward does not clear the retry key for a newer pending burn", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    await refresh();
    const next = await redeem();
    await refresh();

    const retry = await redeem();
    expect(next.id).not.toBe(first.id);
    expect(retry.id).toBe(next.id);
  });

  test("reuses a UUID-only retry key left by an older client", async () => {
    await mount();
    const first = await redeem();
    const key = [...operations.keys()][0];
    if (!key) throw new Error("Missing persisted operation");
    localStorage.setItem(`orbit:redemption:${account.address}:coffee`, key);

    const retry = await redeem();
    expect(retry.id).toBe(first.id);
    expect(orbit.data?.activity).toHaveLength(1);
  });

  test("starts a new redemption when a legacy retry key belongs to a completed reward", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    const key = [...operations.keys()][0];
    if (!key) throw new Error("Missing persisted operation");
    localStorage.setItem(`orbit:redemption:${account.address}:coffee`, key);

    const next = await redeem();
    expect(next.id).not.toBe(first.id);
    expect(next.status).toBe("pending");
  });

  test("recovers an accepted request whose response was lost", async () => {
    await mount();
    lostPrepareResponse = true;
    await act(async () => {
      expect(await orbit.redeem(reward)).toBeNull();
    });
    const prepared = [...operations.values()][0];
    if (!prepared) throw new Error("Missing accepted operation");

    const retry = await redeem();
    expect(retry.id).toBe(prepared.id);
    expect(retry.status).toBe("pending");
    expect(orbit.data?.activity).toHaveLength(1);
  });

  test("does not start another burn when recovery status is unavailable", async () => {
    await mount();
    const first = await redeem();
    operationStatus = 503;
    await act(async () => {
      expect(await orbit.redeem(reward)).toBeNull();
    });
    expect(orbit.error).toContain("Operation unavailable");
    operationStatus = 200;

    const retry = await redeem();
    expect(retry.id).toBe(first.id);
    expect(orbit.data?.activity).toHaveLength(1);
  });

  test("does not return private redemption data after its refresh expires the session", async () => {
    await mount();
    expireAfterSubmit = true;
    let result: Operation | null = null;
    await act(async () => {
      result = await orbit.redeem(reward);
    });

    expect(orbit.mode).toBe("guest");
    expect(result).toBeNull();
  });

  test("discards a delayed claim response when the session expires during submission", async () => {
    await mount();
    holdSubmit = true;
    let redemption: Promise<Operation | null> | undefined;
    await act(async () => {
      redemption = orbit.redeem(reward);
    });
    balanceStatus = 401;
    await refresh();
    let result: Operation | null | undefined;
    await act(async () => {
      const operation = [...operations.values()][0];
      for (const release of releaseSubmissions)
        release(
          Response.json({
            ...operation,
            status: "confirmed",
            claimCode: "old-claim",
          }),
        );
      result = await redemption;
    });

    expect(orbit.mode).toBe("guest");
    expect(result).toBeNull();
    expect(orbit.data).toBeNull();
  });
});

describe("independent member data", () => {
  test("publishes claims while balance is still loading and coalesces overlapping refreshes", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    holdBalance = true;
    let firstRefresh: Promise<void> | undefined;
    let overlappingRefresh: Promise<void> | undefined;
    await act(async () => {
      firstRefresh = orbit.refresh();
      overlappingRefresh = orbit.refresh();
    });
    try {
      expect(orbit.data?.activity[0]?.claimCode).toBe(`claim-${first.id}`);
      expect(releaseBalances).toHaveLength(1);
    } finally {
      await act(async () => {
        for (const release of releaseBalances)
          release(Response.json({ points: "750" }));
        await Promise.all([firstRefresh, overlappingRefresh]);
      });
    }
    expect(orbit.data?.points).toBe("750");
  });

  test("loads reward codes when the first balance request fails", async () => {
    balanceStatus = 503;
    const claim: Operation = {
      id: "completed-redemption",
      wallet: account.address,
      kind: "redeem",
      rewardId: reward.id,
      title: reward.title,
      points: 250,
      status: "confirmed",
      claimCode: "coffee-claim",
      createdAt: "2026-09-18T00:00:00Z",
    };
    operations.set("previous-purchase", claim);
    await mount();

    expect(orbit.data?.activity[0]?.claimCode).toBe("coffee-claim");
    expect(orbit.data?.points).toBeNull();
    expect(orbit.error).toContain("Balance unavailable");
  });

  test("refreshes reward codes and invalidates the balance during an RPC outage", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    balanceStatus = 503;
    await refresh();

    expect(orbit.data?.activity[0]?.claimCode).toBe(`claim-${first.id}`);
    expect(orbit.data?.points).toBeNull();
    balanceStatus = 200;
    points = "750";
    await refresh();
    expect(orbit.data?.points).toBe("750");
    expect(orbit.error).toBe("");
  });

  test("refreshes balance while retaining known claims if activity is unavailable", async () => {
    await mount();
    const first = await redeem();
    settle(first.id);
    await refresh();
    activityStatus = 503;
    points = "750";
    await refresh();

    expect(orbit.data?.points).toBe("750");
    expect(orbit.data?.activity[0]?.claimCode).toBe(`claim-${first.id}`);
    expect(orbit.error).toContain("Activity unavailable");
  });

  test.each(["balance", "activity"] as const)(
    "clears private data when %s reports an expired session",
    async (endpoint) => {
      await mount();
      if (endpoint === "balance") balanceStatus = 401;
      else activityStatus = 401;
      await refresh();

      expect(orbit.mode).toBe("guest");
      expect(orbit.data).toBeNull();
      expect(orbit.connection).toBeNull();
    },
  );
});
