# PaServe frontend conventions

Use [the PaServe design system](../../docs/design-system.md#design-system) for all frontend
UI/UX work. Phase 1 auth styling and the wider Phase 2 workspace treatment,
including viewport fitting and Day/Night appearance, are the current baseline; earlier design iterations
are superseded.

- Reuse `src/theme.css` tokens, the existing shells, controls, Feather icons,
  and `AppearanceToggle`. Adapt the layout to the task while keeping the same
  espresso/cream/lime identity and typography.
- Preserve short-height layouts, mobile usability, 44px primary touch targets,
  keyboard focus, and reduced-motion support. Keep overflow accessible for
  long content and errors.
- Support both appearances and meaningful pending, empty, error, and permission
  states. Show real data and working actions; do not invent metrics or features.
- Before every UI/UX task, read the design system and its feedback guidance.
  Use the approved owner dashboard shell as the business-page reference.
  Consider toast, snackbar, inline message/status bar, alert/banner, and
  dialog/modal for every flow; choose by context rather than displaying all five.
  Reuse the shared feedback components and follow [feedback guidance](../../docs/design-system.md#feedback).
- Keep authentication behavior and backend security boundaries intact during
  visual work. Appearance preference storage must not persist auth credentials.
- Validate changed behavior with appropriate checks. Inspect desktop/mobile
  visuals when a browser is available, and disclose any unverified visual work.
