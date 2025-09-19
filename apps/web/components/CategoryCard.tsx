import Link from 'next/link';
import Image from 'next/image';
import type { IconType } from 'react-icons';
import { FiFolder, FiVideo, FiCast } from 'react-icons/fi';
import { Category } from '@/lib/categories';

const iconMap: Record<string, IconType> = {
  'video-production': FiVideo,
  'live-streaming': FiCast,
};

export default function CategoryCard({ category }: { category: Category }) {
  const Icon = iconMap[category.slug] || FiFolder;

  return (
    <Link
      href={`/categories/${category.slug}`}
      className="card flex flex-col items-center text-center gap-2 p-6"
    >
      {category.headerImage ? (
        <Image
          src={category.headerImage}
          alt={category.name}
          width={80}
          height={80}
          className="w-20 h-20 object-cover rounded-full"
        />
      ) : (
        <Icon className="w-10 h-10 text-orange" />
      )}
      <h3 className="font-medium">{category.name}</h3>
      {category.description && (
        <p className="text-sm text-gray-600">{category.description}</p>
      )}
    </Link>
  );
}
