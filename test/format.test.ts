import { describe, expect, it } from "vitest";
import { formatAmount, formatUnixTime } from "../src/stripe/format.js";

describe("formatAmount", () => {
  it("treats the default currency as 1/100 units", () => {
    expect(formatAmount(1000, "usd")).toBe("10.00 usd");
  });

  it("treats a zero-decimal currency as whole units", () => {
    expect(formatAmount(1000, "jpy")).toBe("1000 jpy");
  });

  // Stripe reports BHD/JOD/KWD/OMR/TND in 1/1000ths; dividing by 100 reports
  // ten times the real amount.
  it("treats a three-decimal currency as 1/1000 units", () => {
    expect(formatAmount(1000, "kwd")).toBe("1.000 kwd");
    expect(formatAmount(1500, "BHD")).toBe("1.500 bhd");
    expect(formatAmount(250, "tnd")).toBe("0.250 tnd");
  });

  it("renders nothing when the amount or currency is absent", () => {
    expect(formatAmount(null, "usd")).toBe("");
    expect(formatAmount(100, undefined)).toBe("");
  });
});

describe("formatUnixTime", () => {
  it("renders an ISO timestamp", () => {
    expect(formatUnixTime(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("renders nothing for a missing timestamp", () => {
    expect(formatUnixTime(undefined)).toBe("");
  });
});
