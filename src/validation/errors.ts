import type { ValidationIssue } from "./types";

/** Typed failure thrown by the assertive validation helpers. */
export class BlockFontValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  public constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "BlockFontValidationError";
    this.issues = Object.freeze([...issues]);
  }
}
