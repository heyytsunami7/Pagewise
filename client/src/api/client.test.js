import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "./client";

const reply = (body, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

let fetchMock;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("apiFetch: success", () => {
    it("returns the parsed JSON and builds the URL, skipping empty query values", async () => {
        fetchMock.mockResolvedValue(reply({ books: [] }));

        const data = await apiFetch("/books", { query: { page: 2, q: "", category: undefined, free: 0 } });

        expect(data).toEqual({ books: [] });
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/books\?page=2&free=0$/);
        expect(options.method).toBe("GET");
        expect(options.body).toBeUndefined();
    });

    it("sends a JSON body with the right header", async () => {
        fetchMock.mockResolvedValue(reply({ ok: true }, 201));

        await apiFetch("/admin/books", { method: "POST", body: { title: "Dune" } });

        const [, options] = fetchMock.mock.calls[0];
        expect(options.method).toBe("POST");
        expect(options.headers["Content-Type"]).toBe("application/json");
        expect(options.body).toBe('{"title":"Dune"}');
    });

    it("adds the Authorization header when a token is given", async () => {
        fetchMock.mockResolvedValue(reply({}));

        await apiFetch("/me", { token: "abc" });

        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer abc");
    });

    it("returns null for an empty body", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        expect(await apiFetch("/cart", { method: "DELETE" })).toBeNull();
    });
});

describe("apiFetch: errors", () => {
    it("turns the server's error shape into an ApiError", async () => {
        const details = [{ path: "pricePaise", message: "Too small" }];
        fetchMock.mockResolvedValue(
            reply({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details } }, 400),
        );

        const err = await apiFetch("/admin/books", { method: "POST", body: {} }).catch((e) => e);

        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(400);
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.message).toBe("Invalid request");
        expect(err.details).toEqual(details);
    });

    it("handles an error response that is not JSON", async () => {
        fetchMock.mockResolvedValue(reply("<html>Bad gateway</html>", 502));

        const err = await apiFetch("/books").catch((e) => e);

        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(502);
        expect(err.code).toBe("HTTP_ERROR");
        expect(err.message).toBe("Request failed (502)");
    });

    it("rejects a successful response that is not JSON", async () => {
        fetchMock.mockResolvedValue(reply("<html>hello</html>", 200));

        const err = await apiFetch("/books").catch((e) => e);

        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe("BAD_RESPONSE");
    });

    it("turns a network failure into an ApiError with status 0", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

        const err = await apiFetch("/books").catch((e) => e);

        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(0);
        expect(err.code).toBe("NETWORK_ERROR");
    });

    it("lets an abort through unchanged", async () => {
        const abort = new DOMException("Aborted", "AbortError");
        fetchMock.mockRejectedValue(abort);

        await expect(apiFetch("/books")).rejects.toBe(abort);
    });
});