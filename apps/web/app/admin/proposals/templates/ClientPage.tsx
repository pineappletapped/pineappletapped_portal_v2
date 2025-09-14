"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { auth, db, functions, storage } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { PDFDownloadLink } from "@react-pdf/renderer";
import ProposalPDF from "@/components/ProposalPDF";

interface ProposalItem { type: "product" | "custom"; productId?: string; name: string; price: number; }

export default function ProposalTemplatesPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [agreementIds, setAgreementIds] = useState<string[]>([]);
  const [brandColor, setBrandColor] = useState("#000000");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setIsStaff(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, "users", user.uid));
      const me = uSnap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const [tplSnap, prodSnap, agrSnap] = await Promise.all([
          getDocs(collection(db, "proposalTemplates")),
          getDocs(collection(db, "products")),
          getDocs(collection(db, "agreements")),
        ]);
        setTemplates(tplSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setAgreements(agrSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
      }
      setLoading(false);
    })();
  }, []);

  const addProduct = (id: string) => {
    const prod = products.find((p) => p.id === id);
    if (prod) setItems((prev) => [...prev, { type: "product", productId: id, name: prod.name, price: prod.price }]);
  };
  const addCustom = () => setItems((prev) => [...prev, { type: "custom", name: "", price: 0 }]);
  const updateItem = (i: number, field: keyof ProposalItem, value: any) => {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  };
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const toggleAgreement = (id: string) => {
    setAgreementIds((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };

  const handleLogo = async (file: File) => {
    try {
      const r = ref(storage, `proposalTemplates/${Date.now()}-${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setLogoUrl(url);
    } catch (err) {
      console.error(err);
      alert("Logo upload failed");
    }
  };

  const save = async () => {
    if (!name) { alert("Name required"); return; }
    try {
      const callable = httpsCallable(functions, "admin_saveProposalTemplate");
      await callable({ name, items, agreementIds, brandColor, logoUrl });
      const snap = await getDocs(collection(db, "proposalTemplates"));
      setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
      setName(""); setItems([]); setAgreementIds([]); setBrandColor("#000000"); setLogoUrl("");
    } catch (err: any) {
      alert(err.message || "Error saving template");
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage templates.</p>;

  return (
    <div className="grid gap-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Proposal Templates</h1>
      <div className="card p-4 grid gap-3">
        <input className="input" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <select className="input" onChange={(e) => { if (e.target.value) { addProduct(e.target.value); e.target.value=""; } }}>
            <option value="">Add product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn" onClick={addCustom}>Add Custom</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">Logo:</label>
          <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); }} />
          {logoUrl && <Image src={logoUrl} alt="logo" width={40} height={40} />}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">Brand color:</label>
          <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
        </div>
        {items.length === 0 ? <p>No items.</p> : (
          <div className="grid gap-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                {it.type === "custom" ? (
                  <>
                    <input className="input flex-1" placeholder="Description" value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                    <input className="input w-24" type="number" value={it.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
                  </>
                ) : (
                  <>
                    <span className="flex-1">{it.name}</span>
                    <span className="w-24 text-right">£{it.price}</span>
                  </>
                )}
                <button className="btn-outline" onClick={() => removeItem(i)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-2">
          {agreements.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input type="checkbox" checked={agreementIds.includes(a.id)} onChange={() => toggleAgreement(a.id)} />
              <span>{a.title || a.id}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between items-center">
          {items.length > 0 && (
            <PDFDownloadLink document={<ProposalPDF proposal={{ name, items, sections: [], terms: '', brandColor, logoUrl }} />} fileName={`${name || 'proposal'}.pdf`}>
              {({ loading }) => <button className="btn-outline" disabled={loading}>{loading ? 'Generating…' : 'Download PDF Preview'}</button>}
            </PDFDownloadLink>
          )}
          <button className="btn" onClick={save}>Save Template</button>
        </div>
      </div>
      <div>
        <h2 className="font-semibold mb-2">Existing Templates</h2>
        {templates.length === 0 ? <p>No templates.</p> : (
          <div className="grid gap-2">
            {templates.map((t) => (
              <div key={t.id} className="card p-4">
                <p className="font-medium">{t.name}</p>
                {t.items && <p className="text-sm">Items: {t.items.length}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
