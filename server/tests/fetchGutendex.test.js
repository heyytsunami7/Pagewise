import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fetchGutendexCatalog, parseGutendexArgs } = require("../scripts/lib/fetchGutendex");

const makeBook = (id) => ({ externalId: String(id), title: `Book ${id}` });

// A fake client whose searchTopic returns canned lists per topic.
function makeClient(booksByTopic) {
  return { searchTopic: vi.fn(async (topic) => booksByTopic[topic] || []) };
}

describe("fetchGutendexCatalog", () => {
  it("keeps up to perCategory books across topics without duplicates", async () => {
    const client = makeClient({
      a: [makeBook(1), makeBook(2)],
      b: [makeBook(2), makeBook(3), makeBook(4)],
    });
    const result = await fetchGutendexCatalog({
      client,
      topics: { Business: ["a", "b"] },
      perCategory: 3,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.source).toBe("gutendex");
    expect(result.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.categories.Business.map((book) => book.externalId)).toEqual(["1", "2", "3"]);
    expect(client.searchTopic).toHaveBeenCalledTimes(2);
    expect(client.searchTopic).toHaveBeenNthCalledWith(1, "a", { limit: 3 });
  });

  it("does not query the next topic once it has enough books", async () => {
    const client = makeClient({ a: [makeBook(1), makeBook(2)], b: [makeBook(3)] });
    await fetchGutendexCatalog({ client, topics: { Business: ["a", "b"] }, perCategory: 2 });
    expect(client.searchTopic).toHaveBeenCalledTimes(1);
  });

  it("skips categories that are already in the existing result", async () => {
    const client = makeClient({ c: [makeBook(5)] });
    const result = await fetchGutendexCatalog({
      client,
      topics: { Mystery: ["a"], Horror: ["c"] },
      existing: { categories: { Mystery: [makeBook(9)] } },
      perCategory: 2,
    });
    expect(client.searchTopic).toHaveBeenCalledTimes(1);
    expect(result.categories.Mystery[0].externalId).toBe("9");
    expect(result.categories.Horror).toHaveLength(1);
  });

  it("reports progress after every category", async () => {
    const client = makeClient({ a: [makeBook(1)], c: [makeBook(2)] });
    const snapshots = [];
    await fetchGutendexCatalog({
      client,
      topics: { Mystery: ["a"], Horror: ["c"] },
      onCategoryDone: async (result) => {
        snapshots.push(Object.keys(result.categories));
      },
    });
    expect(snapshots).toEqual([["Mystery"], ["Mystery", "Horror"]]);
  });

  it("rejects a category that has no topics configured", async () => {
    await expect(
      fetchGutendexCatalog({
        client: makeClient({}),
        topics: { Mystery: ["a"] },
        categories: ["Cooking"],
      }),
    ).rejects.toThrow(/No Gutendex topics/);
  });

  it("stops on a failed search but has already reported earlier categories", async () => {
    const client = {
      searchTopic: vi.fn(async (topic) => {
        if (topic === "c") throw new Error("network down");
        return [makeBook(1)];
      }),
    };
    const snapshots = [];
    await expect(
      fetchGutendexCatalog({
        client,
        topics: { Mystery: ["a"], Horror: ["c"] },
        onCategoryDone: async (result) => {
          snapshots.push(Object.keys(result.categories));
        },
      }),
    ).rejects.toThrow(/network down/);
    expect(snapshots).toEqual([["Mystery"]]);
  });
});

describe("parseGutendexArgs", () => {
  const categories = ["Mystery", "Horror"];

  it("returns sensible defaults", () => {
    expect(parseGutendexArgs([], categories)).toEqual({
      resume: false,
      perCategory: 10,
      only: null,
    });
  });

  it("parses every option", () => {
    const options = parseGutendexArgs(
      ["--resume", "--per-category", "5", "--only", "Mystery, Horror"],
      categories,
    );
    expect(options).toEqual({ resume: true, perCategory: 5, only: ["Mystery", "Horror"] });
  });

  it("rejects unknown options, bad numbers and unknown categories", () => {
    const bad = [
      ["--nope"],
      ["--describe", "3"],
      ["--per-category"],
      ["--per-category", "0"],
      ["--per-category", "101"],
      ["--only", "Cooking"],
      ["--only"],
    ];
    for (const argv of bad) {
      expect(() => parseGutendexArgs(argv, categories)).toThrow();
    }
  });
});
