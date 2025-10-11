const DEFAULT_ORDER_NUMBER_PAD_LENGTH = 5;

type OrderLike = Record<string, any> | null | undefined;

const normaliseString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseOrderNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const integer = Math.trunc(value);
    return integer >= 0 ? integer : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const integer = Math.trunc(parsed);
      return integer >= 0 ? integer : null;
    }
  }
  return null;
};

const formatOrderNumber = (value: number, padLength: number): string => {
  return Math.max(0, Math.trunc(value)).toString().padStart(padLength, "0");
};

export interface OrderIdentifierOptions {
  padLength?: number;
  prefix?: string | null;
  fallbackToOriginal?: boolean;
}

export interface OrderIdentifier {
  rawNumber: number | null;
  friendlyLabel: string | null;
  friendlyDisplay: string | null;
  originalId: string | null;
}

export function resolveOrderIdentifier(
  order: OrderLike,
  options: OrderIdentifierOptions = {},
): OrderIdentifier {
  const padLength = options.padLength ?? DEFAULT_ORDER_NUMBER_PAD_LENGTH;
  const prefix = options.prefix === undefined ? "#" : options.prefix;
  const rawNumber = parseOrderNumber(order && (order.orderNumber ?? order.internalOrderNumber));
  const labelCandidates: Array<string | null> = [];
  if (order) {
    labelCandidates.push(normaliseString(order.orderNumberFormatted));
    labelCandidates.push(normaliseString(order.orderNumberLabel));
    labelCandidates.push(normaliseString(order.orderFriendlyId));
    labelCandidates.push(normaliseString(order.orderNumberDisplay));
    labelCandidates.push(normaliseString(order.orderNumberString));
  }
  let friendlyLabel = labelCandidates.find((candidate) => candidate) ?? null;
  if (!friendlyLabel && rawNumber !== null) {
    friendlyLabel = formatOrderNumber(rawNumber, padLength);
  }
  const friendlyDisplay =
    friendlyLabel !== null ? (prefix ? `${prefix}${friendlyLabel}` : friendlyLabel) : null;
  const originalId = order ? normaliseString(order.id) : null;
  return { rawNumber, friendlyLabel, friendlyDisplay, originalId };
}

export function formatOrderDisplayId(
  order: OrderLike,
  options?: OrderIdentifierOptions,
): string | null {
  const identifier = resolveOrderIdentifier(order, options);
  if (identifier.friendlyDisplay) {
    return identifier.friendlyDisplay;
  }
  if (options?.fallbackToOriginal === false) {
    return null;
  }
  return identifier.originalId;
}

export function formatOrderLabel(
  order: OrderLike,
  options?: { padLength?: number; fallbackToOriginal?: boolean },
): string | null {
  const identifier = resolveOrderIdentifier(order, { ...options, prefix: null });
  if (identifier.friendlyLabel) {
    return identifier.friendlyLabel;
  }
  if (options?.fallbackToOriginal === false) {
    return null;
  }
  return identifier.originalId;
}
