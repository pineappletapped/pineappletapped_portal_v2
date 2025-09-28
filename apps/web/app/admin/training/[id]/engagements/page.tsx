import ClientPage from './ClientPage';

export const metadata = { title: 'Admin – Training Engagement Log | Pineapple Tapped' };

export default function Page({ params }: { params: { id: string } }) {
  return <ClientPage moduleId={params.id} />;
}
