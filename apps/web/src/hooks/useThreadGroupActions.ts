import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  listThreadGroupNames,
  threadGroupName,
  threadGroupTagChanges,
} from "../components/sidebar/threadGroups";
import { THREAD_GROUP_MOVE_ACTION_PREFIX } from "../components/threadActionMenu.logic";
import { requestThreadGroupName } from "../components/ThreadGroupNameDialog";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";
import { readThreadShell, readThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** Group membership is a `group:<name>` thread tag; these change it for one thread or a whole group. */
export function useThreadGroupActions() {
  const setTag = useOrchestrationCommand(threadEnvironment.setTag, { reportFailure: false });
  const unpin = useOrchestrationCommand(threadEnvironment.unpin, { reportFailure: false });

  /**
   * A pinned thread is asked about first: it joins the group only once unpinned, so it leaves
   * Pinned and settles like any other thread. False when the user keeps it pinned.
   */
  const unpinForGroup = async (thread: EnvironmentThreadShell, next: string) => {
    if (thread.pinnedAt == null) return true;
    const api = readLocalApi();
    if (!api) return false;
    let confirmed = false;
    try {
      confirmed = await api.dialogs.confirm(
        [`"${thread.title}" is pinned.`, `Unpin it so it can move to the group "${next}"?`].join(
          "\n",
        ),
      );
    } catch {
      return false;
    }
    if (!confirmed) return false;
    const result = await unpin({
      environmentId: thread.environmentId,
      input: { threadId: thread.id },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        failureToast("Failed to unpin thread", squashAtomCommandFailure(result));
      }
      return false;
    }
    return true;
  };

  // Tag changes run in order so a failed add never leaves the thread out of both groups.
  const applyGroup = async (thread: EnvironmentThreadShell, next: string | null) => {
    for (const change of threadGroupTagChanges(thread.source, next)) {
      const result = await setTag({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, tag: change.tag, tagged: change.tagged },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          failureToast(
            next === null ? "Failed to remove thread from group" : "Failed to move thread to group",
            squashAtomCommandFailure(result),
          );
        }
        return false;
      }
    }
    return true;
  };

  const moveThreadToGroup = async (target: ScopedThreadRef, next: string | null) => {
    const thread = readThreadShell(target);
    if (thread === null) return false;
    if (next !== null && !(await unpinForGroup(thread, next))) return false;
    return applyGroup(thread, next);
  };

  const groupMembers = (name: string) =>
    readThreadShells().filter((thread) => threadGroupName(thread.source) === name);

  const renameGroup = async (from: string, to: string) => {
    if (from === to) return;
    for (const thread of groupMembers(from)) {
      if (!(await applyGroup(thread, to))) return;
    }
  };

  const deleteGroup = async (name: string) => {
    for (const thread of groupMembers(name)) {
      if (!(await applyGroup(thread, null))) return;
    }
  };

  /** The thread menu's Group submenu state for this thread. */
  const groupMenuState = (thread: EnvironmentThreadShell) => ({
    names: listThreadGroupNames(readThreadShells().map((shell) => shell.source)),
    current: threadGroupName(thread.source),
  });

  /** Runs a Group submenu choice; false when the action is not a group action. */
  const handleGroupMenuAction = async (target: ScopedThreadRef, action: string) => {
    if (action.startsWith(THREAD_GROUP_MOVE_ACTION_PREFIX)) {
      await moveThreadToGroup(target, action.slice(THREAD_GROUP_MOVE_ACTION_PREFIX.length));
      return true;
    }
    if (action === "group:new") {
      const name = await requestThreadGroupName({ title: "New group", submitLabel: "Create" });
      if (name !== null) await moveThreadToGroup(target, name);
      return true;
    }
    if (action === "group:remove") {
      await moveThreadToGroup(target, null);
      return true;
    }
    return false;
  };

  return {
    moveThreadToGroup,
    renameGroup,
    deleteGroup,
    groupMenuState,
    handleGroupMenuAction,
  };
}
