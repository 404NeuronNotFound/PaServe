export function explanationDuration(text: string) {
  return text.trim()
    ? Math.min(8500, Math.max(2200, text.trim().split(/\s+/).length * 220))
    : 0;
}

/** Four complete drawings: rest, closed-mouth gesture, talking gesture, blink. */
export function keybeenRowAt(
  elapsed: number,
  speakingFor: number,
): 0 | 1 | 2 | 3 {
  if ((elapsed + 2400) % 4300 < 150) return 3;
  if (elapsed >= speakingFor) return 0;
  const sequence = [2, 1, 0, 2, 1, 2, 0, 1] as const;
  return sequence[Math.floor(elapsed / 180) % sequence.length];
}
