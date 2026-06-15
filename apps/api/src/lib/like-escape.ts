/**
 * Escapes PostgreSQL ILIKE/LIKE pattern metacharacters in a user-supplied string
 * so that the value is treated as a literal substring, not a pattern.
 *
 * PostgreSQL's default LIKE escape character is backslash, so we must escape:
 *   % → \%  (wildcard for any sequence of characters)
 *   _ → \_  (wildcard for exactly one character)
 *   \ → \\  (the escape character itself)
 *
 * Usage: ilike(column, `%${escapeLike(userInput)}%`)
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
