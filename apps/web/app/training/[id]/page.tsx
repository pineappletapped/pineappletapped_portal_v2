import ClientPage from './ClientPage';

export const metadata = { title: 'Training Module | Pineapple Tapped' };

export default function Page({ params }: { params: { id: string } }) {
  return <ClientPage moduleId={params.id} />;
}
