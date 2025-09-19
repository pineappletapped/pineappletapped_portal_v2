import clsx from "clsx";
import type { Venue } from "@/lib/venues";

interface VenueMapProps {
  venue?: Pick<Venue, "name" | "latitude" | "longitude" | "mapUrl"> | null;
  className?: string;
  /**
   * Minimum iframe height in pixels. The container remains responsive while
   * ensuring there is enough space for the embedded map to render clearly.
   */
  height?: number;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export default function VenueMap({
  venue,
  className,
  height = 240,
}: VenueMapProps) {
  if (!venue) return null;

  const lat = isCoordinate(venue.latitude) ? venue.latitude : null;
  const lng = isCoordinate(venue.longitude) ? venue.longitude : null;
  const hasCoords = lat !== null && lng !== null;

  const embedUrl = hasCoords
    ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&output=embed`
    : null;

  const fallbackLink = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    : null;

  const rawMapUrl = venue.mapUrl?.trim() || "";
  const mapHref = rawMapUrl || fallbackLink;

  if (!embedUrl && !mapHref) return null;

  const coordinateLabel = hasCoords
    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : null;

  return (
    <div className={clsx("grid gap-2", className)}>
      {embedUrl && (
        <div className="w-full overflow-hidden rounded-md border">
          <iframe
            title={venue.name ? `${venue.name} map` : "Venue map"}
            src={embedUrl}
            className="w-full"
            style={{ minHeight: height }}
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
      <div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
        {coordinateLabel && <span>Coordinates: {coordinateLabel}</span>}
        {mapHref && (
          <a
            className="text-blue-600 hover:underline"
            href={mapHref}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
          </a>
        )}
      </div>
    </div>
  );
}
