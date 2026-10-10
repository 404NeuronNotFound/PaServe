/** Render customer input as text. Never interpret notes as HTML or Markdown. */
export function CustomerNote({ notes }: { notes?: string }) {
  if (!notes?.trim()) return null;
  return (
    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {notes}
    </p>
  );
}
