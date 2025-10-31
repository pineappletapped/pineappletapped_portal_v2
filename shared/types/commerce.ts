export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  date?: string | null;
  category?: string | null;
  variation?: string | null;
  location?: string | null;
  postalCode?: string | null;
  rentalTotal?: number | null;
  metadata?: Record<string, unknown> | null;
  organisation?: {
    id: string | null;
    name: string;
    source?: string | null;
    brandLogoUrl?: string | null;
    brandColors?: string[] | null;
  } | null;
}

export interface Voucher {
  id?: string;
  code: string;
  type?: "percentage" | "fixed" | string | null;
  amount?: number | null;
  locations?: unknown;
  productIds?: unknown;
  categoryIds?: unknown;
  active?: boolean | null;
}

export interface OrderTotals {
  productTotal: number;
  rentalTotal: number;
  discountAmount: number;
  voucherDiscount: number;
  subtotal: number;
  vat: number;
  grandTotal: number;
}

export interface Order {
  id: string;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  companyName: string | null;
  projectName: string | null;
  totals: OrderTotals;
  items: CartItem[];
  voucherCode?: string | null;
  createdAt: string;
}
