import { feedback } from "../../app/stores/feedback";
// One shared queue owns timers, polite announcements, pause and Undo behavior.
export function toast(...args: Parameters<typeof feedback.toast>) { return feedback.toast(...args); }
export function snackbar(...args: Parameters<typeof feedback.snackbar>) { return feedback.snackbar(...args); }
