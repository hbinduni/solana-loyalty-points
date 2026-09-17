import { useCallback, useEffect, useRef, useState } from "react";
import { APIError, post, request } from "./api";
import type { MemberData, Operation, ProgramConfig, Reward } from "./domain";
import {
  demoRewards,
  errorMessage,
  newDemo,
  redeemDemo,
  terminal,
} from "./domain";
import {
  clearAttempt,
  readAttempt,
  saveAttempt,
  settleAttempts,
} from "./redemptions";
import type { Connection, OrbitWallet } from "./wallet";
import { connectWallet, signBurn } from "./wallet";

export function useOrbit() {
  const [mode, setMode] = useState<"guest" | "demo" | "member">("guest");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [address, setAddress] = useState("");
  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [data, setData] = useState<MemberData | null>(null);
  const [demo, setDemo] = useState(newDemo);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const generation = useRef(0);
  const refreshJob = useRef<{
    generation: number;
    promise: Promise<void>;
  } | null>(null);
  const actionLock = useRef(false);

  const loadProgram = useCallback(async () => {
    try {
      const [program, catalog] = await Promise.all([
        request<ProgramConfig>("/config"),
        request<Reward[]>("/rewards"),
      ]);
      setConfig(program);
      setRewards(catalog);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const refresh = useCallback(() => {
    const current = generation.current;
    if (refreshJob.current?.generation === current)
      return refreshJob.current.promise;
    const errors: unknown[] = [];
    const load = async <T>(
      resource: Promise<T>,
      apply: (value: T) => void,
      unavailable?: () => void,
    ) => {
      try {
        const value = await resource;
        if (generation.current !== current) return;
        apply(value);
      } catch (err) {
        if (generation.current !== current) return;
        if (err instanceof APIError && err.status === 401) {
          generation.current++;
          setMode("guest");
          setAddress("");
          setConnection(null);
          setData(null);
          setError("Your session expired. Connect your wallet again.");
          setRefreshError("");
          return;
        }
        unavailable?.();
        errors.push(err);
      }
      setRefreshError([...new Set(errors.map(errorMessage))].join(" "));
    };
    const promise = Promise.all([
      load(
        request<{ points: string }>("/member/balance"),
        (balance) =>
          setData((previous) => ({
            points: balance.points,
            activity: previous?.activity ?? [],
          })),
        () =>
          setData((previous) => ({
            points: null,
            activity: previous?.activity ?? [],
          })),
      ),
      load(request<Operation[]>("/member/activity"), (activity) => {
        setData((previous) => ({
          points: previous?.points ?? null,
          activity,
        }));
        // Publish claims even if local retry storage is unavailable.
        settleAttempts(activity);
      }),
    ]).then(() => {
      if (refreshJob.current?.promise === promise) refreshJob.current = null;
    });
    refreshJob.current = { generation: current, promise };
    return promise;
  }, []);

  useEffect(() => {
    void loadProgram();
    let alive = true;
    void request<{ wallet: string }>("/member/me")
      .then((me) => {
        if (alive) {
          generation.current++;
          setAddress(me.wallet);
          setMode("member");
        }
      })
      .catch(() => {
        /* A guest has no session to restore. */
      });
    return () => {
      alive = false;
    };
  }, [loadProgram]);

  useEffect(() => {
    if (mode !== "member") return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [mode, refresh]);

  const disconnect = useCallback(async () => {
    if (actionLock.current) return;
    try {
      await post("/auth/logout", {});
      generation.current++;
      setMode("guest");
      setAddress("");
      setData(null);
      setConnection(null);
      setNotice("");
      setError("");
      setRefreshError("");
      if (connection)
        await connection.wallet.features["standard:disconnect"]?.disconnect();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [connection]);

  useEffect(() => {
    if (!connection) return;
    return connection.wallet.features["standard:events"].on(
      "change",
      ({ accounts }) => {
        if (
          accounts &&
          !accounts.some(
            (account) => account.address === connection.account.address,
          )
        ) {
          generation.current++;
          setConnection(null);
          setAddress("");
          setData(null);
          setMode("guest");
          setError("Your wallet account changed. Connect again to sign in.");
          setRefreshError("");
          void post("/auth/logout", {}).catch(() => undefined);
        }
      },
    );
  }, [connection]);

  async function connect(wallet: OrbitWallet) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy("Connecting wallet");
    setError("");
    setRefreshError("");
    const current = generation.current;
    try {
      const result = await connectWallet(wallet);
      if (generation.current !== current) return false;
      generation.current++;
      setConnection(result);
      setAddress(result.account.address);
      setData(null);
      setMode("member");
      setNotice("Wallet connected. Your points stay yours.");
      await refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      actionLock.current = false;
      setBusy("");
    }
  }

  function exploreDemo() {
    if (actionLock.current || mode === "member") return;
    generation.current++;
    setMode("demo");
    setError("");
    setRefreshError("");
    setNotice("");
  }

  function leaveDemo() {
    generation.current++;
    setMode("guest");
    setNotice("");
    setError("");
    setRefreshError("");
    void loadProgram();
  }

  async function redeem(reward: Reward): Promise<Operation | null> {
    if (actionLock.current) return null;
    if (mode === "demo") {
      try {
        const next = redeemDemo(demo, reward);
        setDemo(next);
        return next.activity[0] ?? null;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      }
    }
    if (!connection) {
      setError("Connect your wallet before redeeming a reward.");
      return null;
    }
    actionLock.current = true;
    setBusy("Preparing your reward");
    setError("");
    const current = generation.current;
    try {
      let attempt = readAttempt(address, reward.id);
      let operation: Operation | null = null;
      if (attempt) {
        operation = attempt.operationId
          ? await request<Operation>(
              `/member/operations/${attempt.operationId}`,
            )
          : await post<Operation>(
              "/member/redemptions",
              { rewardId: reward.id },
              attempt.key,
            );
        if (generation.current !== current) return null;
        if (terminal(operation.status)) {
          clearAttempt(address, reward.id, attempt);
          attempt = null;
          operation = null;
        }
      }
      attempt ??= { key: crypto.randomUUID() };
      if (!operation) {
        saveAttempt(address, reward.id, attempt);
        operation = await post<Operation>(
          "/member/redemptions",
          { rewardId: reward.id },
          attempt.key,
        );
      }
      if (generation.current !== current) return null;
      attempt = { ...attempt, operationId: operation.id };
      saveAttempt(address, reward.id, attempt);
      if (operation.status === "prepared" && operation.transaction) {
        setBusy("Approve the redemption in your wallet");
        const transaction = await signBurn(connection, operation.transaction);
        if (generation.current !== current) return null;
        setBusy("Submitting your redemption");
        operation = await post<Operation>(
          `/member/operations/${operation.id}/submit`,
          { transaction },
        );
        if (generation.current !== current) return null;
      }
      if (terminal(operation.status)) clearAttempt(address, reward.id, attempt);
      if (operation.status === "failed" || operation.status === "expired")
        throw new Error(
          "This redemption did not complete. No reward was issued. Try again to prepare a new transaction.",
        );
      if (generation.current === current) {
        setNotice(
          operation.status === "confirmed"
            ? "Your reward is ready."
            : "Redemption submitted. Your reward code will appear in Activity after finalization.",
        );
        await refresh();
      }
      return generation.current === current ? operation : null;
    } catch (err) {
      if (generation.current === current) setError(errorMessage(err));
      return null;
    } finally {
      actionLock.current = false;
      setBusy("");
    }
  }

  return {
    mode,
    address,
    config,
    rewards: mode === "demo" ? demoRewards : rewards,
    data: mode === "demo" ? demo : data,
    error: [error, refreshError].filter(Boolean).join(" "),
    notice,
    busy,
    connection,
    connect,
    disconnect,
    exploreDemo,
    leaveDemo,
    redeem,
    refresh,
    loadProgram,
    clearNotice: () => setNotice(""),
    clearError: () => {
      setError("");
      setRefreshError("");
    },
  };
}
