export function pendingActionLabel(label: string) {
  const verbs: Record<string, string> = {
    Delete: "Deleting",
    Archive: "Archiving",
    Restore: "Restoring",
    Remove: "Removing",
    Revoke: "Revoking",
    Enable: "Enabling",
    Disable: "Disabling",
    Assign: "Assigning",
    Discard: "Discarding",
    Confirm: "Confirming",
    Save: "Saving",
    Undo: "Undoing",
    Mark: "Marking",
    Start: "Starting",
    Record: "Recording",
    Reject: "Rejecting",
  };
  const [verb, ...rest] = label.split(" ");
  return `${Object.hasOwn(verbs, verb) ? verbs[verb] : verb}${rest.length ? ` ${rest.join(" ")}` : ""}…`;
}
