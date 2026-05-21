/**
 * Standalone tests for the AsleepError class. The error class is a public type
 * (re-exported from the package root), so its instanceof / message / code /
 * cause contract is part of the public API.
 */
import { AsleepError } from "../Asleep.types";

describe("AsleepError", () => {
  it("extends Error so jest matchers and native try/catch work naturally", () => {
    const err = new AsleepError("FOO", "bar");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AsleepError);
    expect(err.message).toBe("bar");
    expect(err.code).toBe("FOO");
    expect(err.name).toBe("AsleepError");
  });

  it("preserves cause for observability tooling", () => {
    const native = { errorCode: 401, detail: "unauthorized" };
    const err = new AsleepError("AUTH_FAILED", "Unauthorized", native);
    expect(err.cause).toBe(native);
  });

  it("is throwable and catches like a normal Error", () => {
    expect(() => {
      throw new AsleepError("BOOM", "fell over");
    }).toThrow("fell over");

    try {
      throw new AsleepError("BOOM", "fell over");
    } catch (e) {
      expect(e).toBeInstanceOf(AsleepError);
      if (e instanceof AsleepError) {
        expect(e.code).toBe("BOOM");
      }
    }
  });

  it("retains AsleepError identity through .toString()", () => {
    const err = new AsleepError("X", "y");
    expect(err.toString()).toContain("AsleepError");
    expect(err.toString()).toContain("y");
  });
});
