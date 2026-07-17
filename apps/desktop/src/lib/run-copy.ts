const INTERNAL_PERSISTENCE_ERROR =
  /Failed query:|insert into|update .+ set|SQLITE_|cannot commit transaction/i;

/** Keep provider and persistence internals out of user-facing run surfaces. */
export function presentRunText(value: string | undefined, fallback: string) {
  const text = value?.trim();
  if (!text) return fallback;
  if (INTERNAL_PERSISTENCE_ERROR.test(text)) {
    return "Chief could not save this run cleanly. Nothing external was changed.";
  }
  return text.replace(/—/g, ". ").slice(0, 2_000);
}
