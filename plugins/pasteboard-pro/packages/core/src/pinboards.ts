const ORDER_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPEN_UPPER_DIGIT = ORDER_ALPHABET.length;
const SUFFIX_MIDPOINT =
  ORDER_ALPHABET[Math.floor(ORDER_ALPHABET.length / 2)]!;

function validateOrderKey(key: string | undefined): void {
  if (key === undefined) {
    return;
  }

  if (
    key.length === 0 ||
    [...key].some((character) => !ORDER_ALPHABET.includes(character))
  ) {
    throw new TypeError("Order keys must contain only base62 characters");
  }
}

export function orderKeyBetween(before?: string, after?: string): string {
  validateOrderKey(before);
  validateOrderKey(after);

  if (before !== undefined && after !== undefined && before >= after) {
    throw new RangeError("The lower order key must sort before the upper key");
  }

  if (before === undefined && after === undefined) {
    return "a0";
  }

  let prefix = "";
  let index = 0;

  while (
    before !== undefined &&
    after !== undefined &&
    index < before.length &&
    index < after.length &&
    before[index] === after[index]
  ) {
    prefix += before[index]!;
    index += 1;
  }

  const lowerDigit =
    before !== undefined && index < before.length
      ? ORDER_ALPHABET.indexOf(before[index]!)
      : -1;
  const upperDigit =
    after !== undefined && index < after.length
      ? ORDER_ALPHABET.indexOf(after[index]!)
      : OPEN_UPPER_DIGIT;

  if (upperDigit - lowerDigit > 1) {
    const midpoint = Math.floor((lowerDigit + upperDigit) / 2);
    return prefix + ORDER_ALPHABET[midpoint]!;
  }

  if (lowerDigit >= 0 && before !== undefined) {
    return before + SUFFIX_MIDPOINT;
  }

  if (after !== undefined && index + 1 < after.length) {
    return after.slice(0, index + 1);
  }

  throw new RangeError(
    "No base62 order key exists in this prefix gap; rebalance is required",
  );
}
