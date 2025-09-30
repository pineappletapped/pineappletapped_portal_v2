import clsx from "clsx";

interface ListingPriceNoteProps {
  className?: string;
  note?: string | null;
  rangeNote?: string | null;
}

export default function ListingPriceNote({
  className,
  note,
  rangeNote,
}: ListingPriceNoteProps) {
  if (!note && !rangeNote) {
    return null;
  }

  return (
    <p className={clsx("text-xs leading-relaxed text-gray-600", className)}>
      {note ? `(${note})` : null}
      {note && rangeNote ? <span className="mx-1">•</span> : null}
      {rangeNote ?? null}
    </p>
  );
}
