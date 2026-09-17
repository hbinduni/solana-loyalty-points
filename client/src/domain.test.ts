import { describe, expect, test } from "bun:test";
import { formatPoints, redeemDemo } from "./domain";

describe("demo redemption", () => {
  test("deducts points once and records a clearly labelled demo claim", () => {
    const reward = {
      id: "coffee",
      title: "Coffee",
      description: "",
      category: "Food & drink",
      points: 250,
    };
    const result = redeemDemo({ points: "400", activity: [] }, reward);
    expect(result.points).toBe("150");
    expect(result.activity[0]?.claimCode).toStartWith("DEMO-");
    expect(result.activity[0]?.signature).toBeUndefined();
    expect(() => redeemDemo(result, reward)).toThrow("more points");
  });
  test("formats chain balances without losing integer precision", () => {
    expect(formatPoints("9007199254740993")).toBe("9,007,199,254,740,993");
  });
});
