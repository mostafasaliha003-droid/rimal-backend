export function childAgeInput(text: string): number | '' {
  const ascii = text.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)));
  return /^\d{1,2}$/.test(ascii) ? Number(ascii) : '';
}
