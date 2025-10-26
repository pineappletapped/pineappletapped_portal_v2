import { describe, expect, it } from "vitest";
import type { FirebaseError } from "firebase/app";

import { describeCallableError } from "../useCheckoutPayment";

const createFirebaseError = (code: string, message: string): FirebaseError =>
  Object.assign(new Error(message), { code, name: "FirebaseError" }) as FirebaseError;

describe("describeCallableError", () => {
  it("returns the fallback for nullish errors", () => {
    expect(describeCallableError(undefined)).toBe("We couldn't complete your order. Please try again.");
  });

  it("returns string errors verbatim", () => {
    expect(describeCallableError("Checkout temporarily unavailable"))
      .toBe("Checkout temporarily unavailable");
  });

  it("translates known Firebase error codes", () => {
    const error = createFirebaseError("functions/permission-denied", "FirebaseError: permission-denied");
    expect(describeCallableError(error)).toBe("You do not have permission to complete this order.");
  });

  it("strips FirebaseError prefixes when possible", () => {
    const error = createFirebaseError("functions/invalid-argument", "FirebaseError: invalid payload");
    expect(describeCallableError(error)).toBe(
      "Checkout details were incomplete. Review your information and try again.",
    );
  });

  it("prefers explicit error messages when available", () => {
    const custom = new Error("Service is unavailable right now.");
    expect(describeCallableError(custom)).toBe("Service is unavailable right now.");
  });
});
