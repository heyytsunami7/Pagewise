import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CATEGORY_PRIORITY,
  CATEGORY_KEYWORDS,
  matchingCategories,
  assignCategory,
} = require("../scripts/lib/categoryMap");
const { CATEGORIES } = require("../src/constants");

describe("assignCategory from subjects", () => {
  it.each([
    [["Detective and mystery stories"], "Mystery"],
    [["Gothic fiction", "Ghost stories"], "Horror"],
    [["Fantasy fiction", "Magic"], "Fantasy"],
    [["Wit and humor"], "Humor"],
    [["Authors, English -- Biography"], "Biography"],
    [["Self-help", "Mind and body"], "Psychology"],
    [["World War, 1939-1945"], "History"],
    [["Entrepreneurship"], "Business"],
    [["Essays"], "Non-Fiction"],
    [["Fiction"], "Fiction"],
  ])("maps %j to %s", (subjects, expected) => {
    expect(assignCategory(subjects)).toBe(expected);
  });

  it("does not let fiction-looking subjects count towards factual categories", () => {
    expect(assignCategory(["Historical fiction"])).toBe("Fiction");
    expect(assignCategory(["Science fiction"])).toBe("Fiction");
    expect(assignCategory(["Non-fiction"])).toBe("Non-Fiction");
    expect(assignCategory(["Nonfiction"])).toBe("Non-Fiction");
  });

  it("matches whole words only", () => {
    expect(assignCategory(["Remind", "Warfare", "Mindfulness"])).toBeNull();
  });

  it("returns null when nothing matches or the input is unusable", () => {
    expect(assignCategory(["Cookery", "Gardening"])).toBeNull();
    expect(assignCategory([])).toBeNull();
    expect(assignCategory(undefined)).toBeNull();
    expect(assignCategory([42, null])).toBeNull();
  });

  it("ignores letter case", () => {
    expect(assignCategory(["DETECTIVE STORIES"])).toBe("Mystery");
  });

  it("lists every matching category, most specific first", () => {
    expect(matchingCategories(["Detective stories", "Fiction", "Humor"])).toEqual([
      "Mystery",
      "Humor",
      "Fiction",
    ]);
  });
});

describe("assignCategory with hints", () => {
  it("lets a confirmed hint beat the default priority", () => {
    const subjects = ["Mystery", "Horror"];
    expect(assignCategory(subjects)).toBe("Mystery");
    expect(assignCategory(subjects, { hints: "Horror" })).toBe("Horror");
    expect(assignCategory(subjects, { hints: "Mystery" })).toBe("Mystery");
  });

  it("ignores a hint the subjects do not confirm", () => {
    expect(assignCategory(["Mystery", "Horror"], { hints: "Fantasy" })).toBe("Mystery");
    expect(assignCategory(["Cookery"], { hints: "Fiction" })).toBeNull();
  });

  it("keeps Fiction and Non-Fiction when the fetch category confirms them", () => {
    expect(assignCategory(["Mystery", "Fiction"], { hints: "Fiction" })).toBe("Fiction");
    expect(assignCategory(["Essays", "History"], { hints: "Non-Fiction" })).toBe("Non-Fiction");
  });

  it("prefers a specific genre hint over a generic one for the same book", () => {
    const subjects = ["Mystery", "Fiction"];
    expect(assignCategory(subjects, { hints: ["Fiction", "Mystery"] })).toBe("Mystery");
  });

  it("accepts a single hint or a list of hints", () => {
    const subjects = ["Mystery", "Horror"];
    expect(assignCategory(subjects, { hints: "Horror" })).toBe("Horror");
    expect(assignCategory(subjects, { hints: ["Horror"] })).toBe("Horror");
  });
});

describe("category tables", () => {
  it("covers exactly the ten categories, with the generic ones last", () => {
    expect([...CATEGORY_PRIORITY].sort()).toEqual([...CATEGORIES].sort());
    expect(CATEGORY_PRIORITY).toHaveLength(10);
    expect(CATEGORY_PRIORITY.slice(-2)).toEqual(["Non-Fiction", "Fiction"]);
    expect(Object.keys(CATEGORY_KEYWORDS).sort()).toEqual([...CATEGORIES].sort());
  });

  it("gives every category lowercase keywords", () => {
    for (const keywords of Object.values(CATEGORY_KEYWORDS)) {
      expect(keywords.length).toBeGreaterThan(0);
      for (const keyword of keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
        expect(keyword.length).toBeGreaterThan(0);
      }
    }
  });
});
