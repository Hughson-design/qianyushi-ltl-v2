export function formatPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10 || /[a-z]/i.test(trimmed)) return trimmed;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** Keep only the ten national digits while editing a US telephone number. */
export function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && value.trim().startsWith("+1") ? digits.slice(1) : digits;
  return formatPhoneNumber(national.slice(0, 10));
}
