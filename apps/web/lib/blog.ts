export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  imageUrl?: string;
}

const samplePosts: BlogPost[] = [
  {
    id: 'welcome',
    title: 'Welcome to the Pineapple Portal',
    excerpt: 'A new way to manage your video projects, services and bookings.',
    content:
      '<p>The Pineapple Portal brings all of your video production needs into one simple dashboard. Explore services, track projects and collaborate with our team in real time.</p>',
    date: '2024-01-01',
    imageUrl: 'https://placehold.co/600x400',
  },
  {
    id: 'livestream-tips',
    title: '5 Tips for a Standout Livestream',
    excerpt: 'Make your next livestream engaging and glitch-free with these simple tips.',
    content:
      '<p>Preparation is everything. From testing your connection to planning interactive moments, we break down the essentials for a successful broadcast.</p>',
    date: '2024-02-15',
    imageUrl: 'https://placehold.co/600x400',
  },
];

export async function getPosts(): Promise<BlogPost[]> {
  return samplePosts;
}

export async function getPost(id: string): Promise<BlogPost | null> {
  return samplePosts.find((p) => p.id === id) || null;
}
