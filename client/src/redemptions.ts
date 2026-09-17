import type { Operation } from "./domain";
import { terminal } from "./domain";

export type RedemptionAttempt = { key: string; operationId?: string };

function storageKey(wallet: string, rewardId: string) {
  return `orbit:redemption:${wallet}:${rewardId}`;
}

export function readAttempt(
  wallet: string,
  rewardId: string,
): RedemptionAttempt | null {
  const stored = localStorage.getItem(storageKey(wallet, rewardId));
  if (!stored) return null;
  // Preserve UUID-only keys from earlier clients so retries stay idempotent.
  if (!stored.startsWith("{")) return { key: stored };
  const value: unknown = JSON.parse(stored);
  if (
    !value ||
    typeof value !== "object" ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    ("operationId" in value && typeof value.operationId !== "string")
  )
    throw new Error("Cannot recover this redemption. Please contact support.");
  return value as RedemptionAttempt;
}

export function saveAttempt(
  wallet: string,
  rewardId: string,
  attempt: RedemptionAttempt,
) {
  localStorage.setItem(storageKey(wallet, rewardId), JSON.stringify(attempt));
}

export function clearAttempt(
  wallet: string,
  rewardId: string,
  attempt: RedemptionAttempt,
) {
  if (readAttempt(wallet, rewardId)?.key === attempt.key)
    localStorage.removeItem(storageKey(wallet, rewardId));
}

export function settleAttempts(operations: Operation[]) {
  for (const operation of operations) {
    if (
      operation.kind !== "redeem" ||
      !operation.rewardId ||
      !terminal(operation.status)
    )
      continue;
    const attempt = readAttempt(operation.wallet, operation.rewardId);
    if (attempt?.operationId === operation.id)
      clearAttempt(operation.wallet, operation.rewardId, attempt);
  }
}
