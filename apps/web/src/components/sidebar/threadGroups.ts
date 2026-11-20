/**
 * Thread groups: user-named sidebar shelves that sit beside Snoozed and Settled.
 *
 * A thread joins a group through one server-side thread tag, `group:<name>`, so membership
 * syncs to every client and survives restarts. A group exists while some loaded thread
 * carries its tag; there is no separate group list to keep in step.
 */

const THREAD_GROUP_TAG_PREFIX = "group:";
/** Thread tags are at most 64 characters, and the prefix takes 6 of them. */
export const THREAD_GROUP_NAME_MAX_LENGTH = 64 - THREAD_GROUP_TAG_PREFIX.length;

const GROUP_HEADER_MARKER_PREFIX = "group-header:";

export type SidebarGroupHeaderMarker = `group-header:${string}`;

/** A trimmed, single-line name, or null when nothing usable is left or it is too long. */
export function normalizeThreadGroupName(input: string): string | null {
  const name = input
    .replace(/[\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "" || name.length > THREAD_GROUP_NAME_MAX_LENGTH) return null;
  return name;
}

function threadGroupTag(name: string): string {
  return `${THREAD_GROUP_TAG_PREFIX}${name}`;
}

/** The thread's group. A thread tagged into several groups (written by hand) shows in the first. */
export function threadGroupName(thread: {
  readonly tags?: ReadonlyArray<string> | undefined;
}): string | null {
  for (const tag of thread.tags ?? []) {
    if (!tag.startsWith(THREAD_GROUP_TAG_PREFIX)) continue;
    const name = normalizeThreadGroupName(tag.slice(THREAD_GROUP_TAG_PREFIX.length));
    if (name !== null) return name;
  }
  return null;
}

function compareThreadGroupNames(left: string, right: string): number {
  return (
    left.localeCompare(right, undefined, { sensitivity: "base", numeric: true }) ||
    left.localeCompare(right)
  );
}

/** Every group some thread belongs to, in shelf order. */
export function listThreadGroupNames(
  threads: ReadonlyArray<{ readonly tags?: ReadonlyArray<string> | undefined }>,
): string[] {
  const names = new Set<string>();
  for (const thread of threads) {
    const name = threadGroupName(thread);
    if (name !== null) names.add(name);
  }
  return [...names].toSorted(compareThreadGroupNames);
}

export interface ThreadTagChange {
  readonly tag: string;
  readonly tagged: boolean;
}

/**
 * The tag commands that move a thread into `next` (or out of every group when null).
 * Every other `group:` tag is removed, so a thread is never in two groups.
 */
export function threadGroupTagChanges(
  thread: { readonly tags?: ReadonlyArray<string> | undefined },
  next: string | null,
): ThreadTagChange[] {
  const nextTag = next === null ? null : threadGroupTag(next);
  const current = thread.tags ?? [];
  const changes: ThreadTagChange[] = current
    .filter((tag) => tag.startsWith(THREAD_GROUP_TAG_PREFIX) && tag !== nextTag)
    .map((tag) => ({ tag, tagged: false }));
  if (nextTag !== null && !current.includes(nextTag)) {
    changes.unshift({ tag: nextTag, tagged: true });
  }
  return changes;
}

export function sidebarGroupHeaderMarker(name: string): SidebarGroupHeaderMarker {
  return `${GROUP_HEADER_MARKER_PREFIX}${name}`;
}

export function isSidebarGroupHeaderMarker(marker: string): marker is SidebarGroupHeaderMarker {
  return marker.startsWith(GROUP_HEADER_MARKER_PREFIX);
}

export function sidebarGroupNameOfMarker(marker: string): string | null {
  return isSidebarGroupHeaderMarker(marker)
    ? marker.slice(GROUP_HEADER_MARKER_PREFIX.length)
    : null;
}

/** Group shelves start open; the stored map keeps only the ones the user closed or reopened. */
export function isThreadGroupExpanded(
  expandedByName: Readonly<Record<string, boolean>>,
  name: string,
): boolean {
  return expandedByName[name] ?? true;
}

/**
 * The group a dragged thread would land in when dropped over `overId`: the group whose
 * shelf header is the last marker above the drop slot. Null outside every group shelf.
 */
export function resolveSidebarGroupDropTarget<
  Item extends
    | { readonly kind: "thread"; readonly key: string }
    | { readonly kind: "marker"; readonly marker: string },
>(
  items: ReadonlyArray<Item>,
  itemId: (item: Item) => string,
  activeKey: string,
  overId: string,
): string | null {
  const activeIndex = items.findIndex((item) => itemId(item) === activeKey);
  const overIndex = items.findIndex((item) => itemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1) return null;
  const over = items[overIndex]!;
  // Dropping on a header always means that group, wherever the drag came from.
  if (over.kind === "marker") return sidebarGroupNameOfMarker(over.marker);
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  for (let index = overIndex - 1; index >= 0; index -= 1) {
    const item = moved[index]!;
    if (item.kind === "marker") return sidebarGroupNameOfMarker(item.marker);
  }
  return null;
}

/**
 * Where a group shelf sits: above Pinned, between Pinned and Active, or in the bottom area with
 * Snoozed and Settled. Kept per device, like the shelves' open state.
 */
export type ThreadGroupZone = "top" | "middle" | "bottom";

export const THREAD_GROUP_ZONES: ReadonlyArray<ThreadGroupZone> = ["top", "middle", "bottom"];

export type ThreadGroupPlacement = Readonly<
  Record<string, { readonly zone: ThreadGroupZone; readonly rank: number }>
>;

export type ArrangedThreadGroups = Readonly<Record<ThreadGroupZone, ReadonlyArray<string>>>;

/** The groups by zone, in shelf order. A group never placed goes to the bottom, by name. */
export function arrangeThreadGroups(
  names: ReadonlyArray<string>,
  placement: ThreadGroupPlacement,
): ArrangedThreadGroups {
  const sorted = names.toSorted((left, right) => {
    const leftRank = placement[left]?.rank ?? Number.POSITIVE_INFINITY;
    const rightRank = placement[right]?.rank ?? Number.POSITIVE_INFINITY;
    return leftRank === rightRank
      ? compareThreadGroupNames(left, right)
      : leftRank < rightRank
        ? -1
        : 1;
  });
  const zoneOf = (name: string): ThreadGroupZone => placement[name]?.zone ?? "bottom";
  return {
    top: sorted.filter((name) => zoneOf(name) === "top"),
    middle: sorted.filter((name) => zoneOf(name) === "middle"),
    bottom: sorted.filter((name) => zoneOf(name) === "bottom"),
  };
}

/**
 * The placement after moving `name` to slot `index` of `zone`, where the slot counts the
 * shelves as they are shown before the move (so dropping just below itself changes nothing).
 * Every shown group gets a rank, so later groups never jump ahead of placed ones.
 */
export function moveThreadGroup(
  arranged: ArrangedThreadGroups,
  name: string,
  zone: ThreadGroupZone,
  index: number,
): ThreadGroupPlacement {
  const from = arranged[zone].indexOf(name);
  const target = from !== -1 && from < index ? index - 1 : index;
  const zones = Object.fromEntries(
    THREAD_GROUP_ZONES.map((entry) => [entry, arranged[entry].filter((other) => other !== name)]),
  ) as Record<ThreadGroupZone, string[]>;
  zones[zone].splice(Math.max(0, Math.min(target, zones[zone].length)), 0, name);
  const placement: Record<string, { zone: ThreadGroupZone; rank: number }> = {};
  for (const entry of THREAD_GROUP_ZONES) {
    for (const [rank, group] of zones[entry].entries()) placement[group] = { zone: entry, rank };
  }
  return placement;
}

/** A renamed group keeps its place; a deleted one gives it up. */
export function renameThreadGroupPlacement(
  placement: ThreadGroupPlacement,
  from: string,
  to: string | null,
): ThreadGroupPlacement {
  const entry = placement[from];
  if (entry === undefined) return placement;
  const { [from]: _removed, ...rest } = placement;
  return to === null ? rest : { ...rest, [to]: entry };
}
