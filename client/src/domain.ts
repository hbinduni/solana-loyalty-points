export type Reward = {
  id: string;
  title: string;
  description: string;
  category: string;
  points: number;
};
export type Operation = {
  id: string;
  wallet: string;
  kind: "earn" | "redeem";
  rewardId?: string;
  title: string;
  points: number;
  status: "prepared" | "pending" | "confirmed" | "failed" | "expired";
  createdAt: string;
  signature?: string;
  transaction?: string;
  claimCode?: string;
  fulfilledAt?: string;
};
export type MemberData = { points: string | null; activity: Operation[] };
export type DemoData = MemberData & { points: string };
export type ProgramConfig = {
  network: string;
  configured: boolean;
  mint: string;
  transferable: false;
};

export const demoRewards: Reward[] = [
  {
    id: "coffee",
    title: "Your next coffee, on us",
    description:
      "A handcrafted coffee of your choice. Show your reward code at the counter.",
    category: "Food & drink",
    points: 250,
  },
  {
    id: "discount",
    title: "A little off your next visit",
    description: "Enjoy 10% off your next purchase. One reward per purchase.",
    category: "Shopping",
    points: 500,
  },
  {
    id: "tote",
    title: "The everyday tote",
    description:
      "A reusable cotton tote for wherever the day takes you. Collect in store.",
    category: "Merch",
    points: 1200,
  },
];

export function newDemo(): DemoData {
  return {
    points: "2450",
    activity: [
      {
        id: "demo-1",
        wallet: "demo",
        kind: "earn",
        title: "Your weekend visit",
        points: 450,
        status: "confirmed",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: "demo-2",
        wallet: "demo",
        kind: "redeem",
        rewardId: "coffee",
        title: "Your next coffee, on us",
        points: 250,
        status: "confirmed",
        claimCode: "DEMO-COFFEE",
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      },
      {
        id: "demo-3",
        wallet: "demo",
        kind: "earn",
        title: "A little retail therapy",
        points: 1250,
        status: "confirmed",
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      },
      {
        id: "demo-4",
        wallet: "demo",
        kind: "earn",
        title: "Welcome to Orbit",
        points: 1000,
        status: "confirmed",
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      },
    ],
  };
}

export function redeemDemo(data: DemoData, reward: Reward): DemoData {
  if (BigInt(data.points) < BigInt(reward.points))
    throw new Error("You need more points for this reward");
  return {
    points: (BigInt(data.points) - BigInt(reward.points)).toString(),
    activity: [
      {
        id: crypto.randomUUID(),
        wallet: "demo",
        kind: "redeem",
        rewardId: reward.id,
        title: reward.title,
        points: reward.points,
        status: "confirmed",
        createdAt: new Date().toISOString(),
        claimCode: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      },
      ...data.activity,
    ],
  };
}

export function formatPoints(points: string | number): string {
  return BigInt(points).toLocaleString("en-US");
}
export function shortWallet(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export const terminal = (status: Operation["status"]) =>
  ["confirmed", "failed", "expired"].includes(status);
