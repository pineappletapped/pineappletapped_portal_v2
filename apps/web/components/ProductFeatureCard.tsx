import { ReactNode } from "react";
import type { IconType } from "react-icons";

interface ProductFeatureCardProps {
  title: string;
  icon: IconType;
  children: ReactNode;
}

export default function ProductFeatureCard({
  title,
  icon: Icon,
  children,
}: ProductFeatureCardProps) {
  return (
    <div className="flex gap-3 p-4 border rounded-lg bg-white shadow-sm">
      <Icon className="w-6 h-6 text-orange mt-1 shrink-0" />
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <div className="text-sm text-gray-700">{children}</div>
      </div>
    </div>
  );
}

