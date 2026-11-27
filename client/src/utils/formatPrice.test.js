import { describe, it, expect } from "vitest";
import { formatPrice } from "./formatPrice";

describe("formatPrice", () => {
    it("shows whole rupees without decimals", () => {
        expect(formatPrice(49900)).toBe("₹499");
        expect(formatPrice(100)).toBe("₹1");
    });

    it("shows paise with two decimals", () => {
        expect(formatPrice(49950)).toBe("₹499.50");
        expect(formatPrice(4901)).toBe("₹49.01");
    });

    it("shows zero", () => {
        expect(formatPrice(0)).toBe("₹0");
    });

    it("uses Indian digit grouping for large values", () => {
        expect(formatPrice(99900)).toBe("₹999");
        expect(formatPrice(123456700)).toBe("₹12,34,567");
    });

    it("returns an empty string for a missing or invalid value", () => {
        expect(formatPrice(undefined)).toBe("");
        expect(formatPrice(null)).toBe("");
        expect(formatPrice(NaN)).toBe("");
    });
});