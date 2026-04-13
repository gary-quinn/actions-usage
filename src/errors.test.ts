import { describe, it, expect } from "vitest";
import { causeChain } from "./errors.js";

describe("causeChain", () => {
  it("returns single message for Error without cause", () => {
    expect(causeChain(new Error("top"))).toEqual(["top"]);
  });

  it("walks nested cause chain", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    expect(causeChain(top)).toEqual(["top", "mid", "root"]);
  });

  it("captures non-Error tail cause", () => {
    const top = new Error("top", { cause: "network timeout" });
    expect(causeChain(top)).toEqual(["top", "network timeout"]);
  });

  it("captures non-Error tail after Error chain", () => {
    const mid = new Error("mid", { cause: 42 });
    const top = new Error("top", { cause: mid });
    expect(causeChain(top)).toEqual(["top", "mid", "42"]);
  });

  it("returns stringified value for non-Error thrown value", () => {
    expect(causeChain("oops")).toEqual(["oops"]);
  });

  it("ignores undefined/null cause", () => {
    expect(causeChain(new Error("top", { cause: undefined }))).toEqual(["top"]);
    expect(causeChain(new Error("top", { cause: null }))).toEqual(["top"]);
  });
});
