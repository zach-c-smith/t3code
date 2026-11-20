import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { normalizeThreadGroupName, THREAD_GROUP_NAME_MAX_LENGTH } from "./sidebar/threadGroups";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type GroupNameRequest = {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName: string;
  readonly resolve: (name: string | null) => void;
};
const useRequest = create<{ request: GroupNameRequest | null }>(() => ({ request: null }));

/** Asks for a group name; resolves null when the user cancels. */
export function requestThreadGroupName(options: {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName?: string;
}): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) =>
    useRequest.setState({
      request: {
        title: options.title,
        submitLabel: options.submitLabel,
        initialName: options.initialName ?? "",
        resolve,
      },
    }),
  );
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ThreadGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves any pending group name request with null when the dialog host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupNameDialog key={request.title} request={request} /> : null;
}

function ThreadGroupNameDialog(props: { readonly request: GroupNameRequest }) {
  const { request } = props;
  const id = useId();
  const [name, setName] = useState(request.initialName);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeThreadGroupName(name);
            if (normalized === null) {
              setError(`Enter a name of 1 to ${THREAD_GROUP_NAME_MAX_LENGTH} characters.`);
              return;
            }
            finish(normalized);
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>
              Groups are shelves in the sidebar, like Snoozed and Settled.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                autoFocus
                value={name}
                maxLength={THREAD_GROUP_NAME_MAX_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit">{request.submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
