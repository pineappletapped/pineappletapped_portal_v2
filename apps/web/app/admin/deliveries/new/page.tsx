import { Suspense } from "react";
import ClientPage from "./ClientPage";

export const metadata = { title: "Admin – Stage Delivery Assets | Pineapple Tapped" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  );
}
