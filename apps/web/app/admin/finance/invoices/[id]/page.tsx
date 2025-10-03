import ClientPage from './ClientPage';

export const metadata = { title: 'Admin – Invoice | Pineapple Tapped' };

export default function Page({ params }: { params: { id: string } }) {
  return <ClientPage invoiceId={params.id} />;
}
