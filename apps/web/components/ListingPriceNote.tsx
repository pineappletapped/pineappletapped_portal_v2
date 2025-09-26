import Link from "next/link";

interface ListingPriceNoteProps {
  className?: string;
}

export default function ListingPriceNote({
  className,
}: ListingPriceNoteProps) {
  const baseClass = "text-xs text-gray-600";
  const mergedClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <p className={mergedClass}>
      Final pricing may vary by region. Provide your shoot location during
      checkout or {" "}
      <Link href="/login" className="font-medium text-orange hover:underline">
        log in
      </Link>{" "}
      to request a tailored quote.
    </p>
  );
}
