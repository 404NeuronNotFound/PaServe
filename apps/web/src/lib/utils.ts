import { clsx, type ClassValue } from "clsx";

/** This project uses token-based CSS, so utility-class conflict merging is unnecessary. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
