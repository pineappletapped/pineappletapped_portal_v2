import Image from 'next/image';
import { getPost } from '@/lib/blog';

export default async function BlogPostPage({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) {
    return <div className="mx-auto max-w-3xl px-4 py-6">Post not found.</div>;
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-6 prose">
      <h1>{post.title}</h1>
      <p className="text-sm text-gray-500">{post.date}</p>
      {post.imageUrl && (
        <Image
          src={post.imageUrl}
          alt={post.title}
          width={960}
          height={540}
          className="w-full rounded"
        />
      )}
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  );
}
