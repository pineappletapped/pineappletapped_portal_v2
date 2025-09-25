import clsx from "clsx";
import type { FranchiseTerritory } from "@/lib/franchises";

interface TerritoryMapProps {
  territory: FranchiseTerritory;
  className?: string;
  height?: number;
}

function buildQuery(territory: FranchiseTerritory): string | null {
  if (territory.type === "radius") {
    const lat = typeof territory.centerLat === "number" ? territory.centerLat : null;
    const lng = typeof territory.centerLng === "number" ? territory.centerLng : null;
    if (lat !== null && lng !== null) {
      return `${lat},${lng}`;
    }
  }
  const firstCode = territory.postalCodes.find((code) => code.trim().length > 0);
  if (firstCode) {
    return firstCode;
  }
  return territory.label.trim() ? territory.label : null;
}

export default function TerritoryMap({ territory, className, height = 220 }: TerritoryMapProps) {
  const query = buildQuery(territory);
  if (!query) return null;

  const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
  const linkUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  return (
    <div className={clsx("grid gap-2", className)}>
      <div className="w-full overflow-hidden rounded-md border">
        <iframe
          title={`${territory.label} map`}
          src={embedUrl}
          className="w-full"
          style={{ minHeight: height }}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <div className="text-xs text-gray-600">
        <a className="text-blue-600 hover:underline" href={linkUrl} target="_blank" rel="noreferrer">
          Open in Maps
        </a>
      </div>
    </div>
  );
}
