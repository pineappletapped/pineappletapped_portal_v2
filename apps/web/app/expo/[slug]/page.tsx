import ClientPage from "./ClientPage";

export const metadata = { title: "Expo Lead Capture | Pineapple Tapped" };

export default function Page({ params }: { params: { slug: string } }) {
  return <ClientPage slug={params.slug} />;
}
