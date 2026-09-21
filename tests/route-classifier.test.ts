import { describe, expect, it } from "vitest";
import { isConcreteRoute, isGenericAutoRoute } from "../src/control/route-classifier.js";

describe("route classifier", () => {
  it("distinguishes generic and concrete routes", () => {
    expect(isGenericAutoRoute("auto")).toBe(true);
    expect(isGenericAutoRoute("best-free")).toBe(true);
    expect(isGenericAutoRoute("kiro/auto")).toBe(false);
    expect(isGenericAutoRoute("cc/auto")).toBe(false);
    expect(isConcreteRoute("kiro/auto")).toBe(true);
    expect(isConcreteRoute("cc/auto")).toBe(true);
    expect(isConcreteRoute("auto")).toBe(false);
  });
});
