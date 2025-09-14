export const VAT_RATE = 0.2;

export function calculateVat(amount: number) {
  const vat = amount * VAT_RATE;
  const total = amount + vat;
  return { vat, total };
}
