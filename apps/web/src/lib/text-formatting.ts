import { titleCase } from "title-case";

/**
 * Converts a snake_case string to Title Case.
 */
export function prettifyText(text: string): string {
  return titleCase(text.replace(/_/g, " "));
}
