const BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/+$/, "");

// Every failed request becomes one of these. status 0 means the server was never reached;
// code is the server's error code; details holds per-field errors for validation failures.
export class ApiError extends Error {
    constructor(message, { status = 0, code = "NETWORK_ERROR", details = null } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function buildUrl(path, query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const search = params.toString();
    return `${BASE_URL}${path}${search ? `?${search}` : ""}`;
}

/**
 * apiFetch("/books", { query: { page: 2 } }) resolves with the parsed JSON body.
 * Options: method, body (sent as JSON), query (empty values are skipped), token, signal.
 * Rejects with an ApiError, except when the caller aborts: that rethrows the AbortError.
 */
export async function apiFetch(path, { method = "GET", body, query, token, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(buildUrl(path, query), {
            method,
            headers,
            signal,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (err) {
        if (err.name === "AbortError") throw err;
        throw new ApiError("Cannot reach the server. Check your connection and try again.");
    }

    const text = await res.text();
    let data = null;
    let isJson = true;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            isJson = false;
        }
    }

    if (!res.ok) {
        const error = isJson && data ? data.error : null;
        throw new ApiError(error?.message || `Request failed (${res.status})`, {
            status: res.status,
            code: error?.code || "HTTP_ERROR",
            details: error?.details ?? null,
        });
    }
    if (!isJson) {
        throw new ApiError("The server sent an unexpected response.", {
            status: res.status,
            code: "BAD_RESPONSE",
        });
    }
    return data;
}