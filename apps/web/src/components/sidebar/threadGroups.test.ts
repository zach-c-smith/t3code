import { describe, expect, it } from "vite-plus/test";

import {
  arrangeThreadGroups,
  isThreadGroupExpanded,
  moveThreadGroup,
  renameThreadGroupPlacement,
  listThreadGroupNames,
  normalizeThreadGroupName,
  resolveSidebarGroupDropTarget,
  sidebarGroupHeaderMarker,
  sidebarGroupNameOfMarker,
  threadGroupName,
  threadGroupTagChanges,
  THREAD_GROUP_NAME_MAX_LENGTH,
} from "./threadGroups";

describe("normalizeThreadGroupName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeThreadGroupName("  Waiting   on\tMike \n")).toBe("Waiting on Mike");
  });
  it("rejects empty and over-long names", () => {
    expect(normalizeThreadGroupName("   ")).toBeNull();
    expect(normalizeThreadGroupName("x".repeat(THREAD_GROUP_NAME_MAX_LENGTH))).not.toBeNull();
    expect(normalizeThreadGroupName("x".repeat(THREAD_GROUP_NAME_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("threadGroupName", () => {
  it("reads the first group tag and ignores other tags", () => {
    expect(threadGroupName({ tags: ["recording", "group:Infra", "group:Other"] })).toBe("Infra");
    expect(threadGroupName({ tags: ["recording"] })).toBeNull();
    expect(threadGroupName({})).toBeNull();
    expect(threadGroupName({ tags: ["group:   "] })).toBeNull();
  });
});

describe("listThreadGroupNames", () => {
  it("lists each group once in natural, case-insensitive order", () => {
    expect(
      listThreadGroupNames([
        { tags: ["group:beta"] },
        { tags: ["group:Alpha"] },
        { tags: ["group:item 10"] },
        { tags: ["group:item 2"] },
        { tags: ["group:beta"] },
        {},
      ]),
    ).toEqual(["Alpha", "beta", "item 2", "item 10"]);
  });
});

describe("threadGroupTagChanges", () => {
  it("adds the new group and removes every other group tag", () => {
    expect(
      threadGroupTagChanges({ tags: ["group:Old", "recording", "group:Stray"] }, "New"),
    ).toEqual([
      { tag: "group:New", tagged: true },
      { tag: "group:Old", tagged: false },
      { tag: "group:Stray", tagged: false },
    ]);
  });
  it("does nothing when the thread is already in the group alone", () => {
    expect(threadGroupTagChanges({ tags: ["group:Same"] }, "Same")).toEqual([]);
  });
  it("removes the thread from every group when the target is null", () => {
    expect(threadGroupTagChanges({ tags: ["group:A", "keep"] }, null)).toEqual([
      { tag: "group:A", tagged: false },
    ]);
  });
});

describe("group header markers", () => {
  it("round-trips a name, including colons", () => {
    expect(sidebarGroupNameOfMarker(sidebarGroupHeaderMarker("a:b"))).toBe("a:b");
    expect(sidebarGroupNameOfMarker("settled-header")).toBeNull();
  });
  it("opens shelves by default", () => {
    expect(isThreadGroupExpanded({}, "A")).toBe(true);
    expect(isThreadGroupExpanded({ A: false }, "A")).toBe(false);
  });
});

describe("resolveSidebarGroupDropTarget", () => {
  type Item =
    | { readonly kind: "thread"; readonly key: string }
    | { readonly kind: "marker"; readonly marker: string };
  const id = (item: Item) => (item.kind === "thread" ? item.key : `m:${item.marker}`);
  const items: Item[] = [
    { kind: "marker", marker: "pinned-header" },
    { kind: "marker", marker: "pinned-divider" },
    { kind: "thread", key: "a1" },
    { kind: "thread", key: "a2" },
    { kind: "marker", marker: sidebarGroupHeaderMarker("Infra") },
    { kind: "thread", key: "g1" },
    { kind: "thread", key: "g2" },
    { kind: "marker", marker: sidebarGroupHeaderMarker("Mike") },
    { kind: "marker", marker: "settled-header" },
    { kind: "thread", key: "s1" },
  ];
  it("targets a group when dropped on its header", () => {
    expect(
      resolveSidebarGroupDropTarget(items, id, "a1", `m:${sidebarGroupHeaderMarker("Mike")}`),
    ).toBe("Mike");
  });
  it("targets a group when dropped among its rows", () => {
    expect(resolveSidebarGroupDropTarget(items, id, "a1", "g2")).toBe("Infra");
  });
  it("is null for active and settled slots", () => {
    expect(resolveSidebarGroupDropTarget(items, id, "g1", "a2")).toBeNull();
    expect(resolveSidebarGroupDropTarget(items, id, "a1", "s1")).toBeNull();
    expect(resolveSidebarGroupDropTarget(items, id, "a1", "m:settled-header")).toBeNull();
  });
  it("is null for unknown ids", () => {
    expect(resolveSidebarGroupDropTarget(items, id, "nope", "g1")).toBeNull();
  });
});

describe("arrangeThreadGroups", () => {
  it("puts unplaced groups at the bottom, by name", () => {
    expect(arrangeThreadGroups(["b", "a"], {})).toEqual({
      top: [],
      middle: [],
      bottom: ["a", "b"],
    });
  });
  it("follows the stored zone and rank, unplaced last", () => {
    const placement = { z: { zone: "top", rank: 0 }, y: { zone: "bottom", rank: 0 } } as const;
    expect(arrangeThreadGroups(["a", "y", "z"], placement)).toEqual({
      top: ["z"],
      middle: [],
      bottom: ["y", "a"],
    });
  });
});

describe("moveThreadGroup", () => {
  const arranged = { top: ["t"], middle: [], bottom: ["a", "b", "c"] } as const;
  it("moves a group to another zone and ranks every group", () => {
    expect(moveThreadGroup(arranged, "b", "middle", 0)).toEqual({
      t: { zone: "top", rank: 0 },
      b: { zone: "middle", rank: 0 },
      a: { zone: "bottom", rank: 0 },
      c: { zone: "bottom", rank: 1 },
    });
  });
  it("counts slots as shown, so moving down past itself lands below the next group", () => {
    const placement = moveThreadGroup(arranged, "a", "bottom", 2);
    expect(arrangeThreadGroups(["a", "b", "c", "t"], placement).bottom).toEqual(["b", "a", "c"]);
  });
  it("leaves the order alone when dropped on its own slot", () => {
    for (const index of [0, 1]) {
      const placement = moveThreadGroup(arranged, "a", "bottom", index);
      expect(arrangeThreadGroups(["a", "b", "c", "t"], placement).bottom).toEqual(["a", "b", "c"]);
    }
  });
  it("moves a group up within its zone", () => {
    const placement = moveThreadGroup(arranged, "c", "bottom", 0);
    expect(arrangeThreadGroups(["a", "b", "c", "t"], placement).bottom).toEqual(["c", "a", "b"]);
  });
});

describe("renameThreadGroupPlacement", () => {
  const placement = { old: { zone: "top", rank: 1 } } as const;
  it("carries the place to the new name", () => {
    expect(renameThreadGroupPlacement(placement, "old", "new")).toEqual({
      new: { zone: "top", rank: 1 },
    });
  });
  it("drops the place of a deleted group", () => {
    expect(renameThreadGroupPlacement(placement, "old", null)).toEqual({});
  });
});
