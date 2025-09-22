"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db, functions } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getProductKit } from "@/lib/equipment";
import { extractUserRoles, hasRole } from "@/lib/roles";

interface ProposalItem {
  type: "product" | "custom";
  productId?: string;
  name: string;
  price: number;
  notes?: string;
  rental?: number;
}

export default function NewProposalPage() {
  const router = useRouter();
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);

  const [orgs, setOrgs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);

  const [orgId, setOrgId] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [agreementIds, setAgreementIds] = useState<string[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setCanManage(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, "users", user.uid));
      const me = uSnap.data() as any;
      const roles = extractUserRoles(me);
      const allowed = hasRole(roles, ["admin", "sales"]);
      setCanManage(allowed);
      if (allowed) {
        const [orgSnap, prodSnap, secSnap, agrSnap, tplSnap] = await Promise.all([
          getDocs(collection(db, "orgs")),
          getDocs(collection(db, "products")),
          getDocs(collection(db, "proposalSections")),
          getDocs(collection(db, "agreements")),
          getDocs(collection(db, "proposalTemplates")),
        ]);
        setOrgs(orgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setSections(secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setAgreements(agrSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setTemplates(tplSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      setItems(tpl.items || []);
      setAgreementIds(tpl.agreementIds || []);
      setSectionIds(tpl.sectionIds || []);
    }
  }, [templateId, templates]);

  useEffect(() => {
    async function fillRental() {
      const updated = await Promise.all(
        items.map(async (it) => {
          if (it.type === "product" && it.productId && typeof it.rental === "undefined") {
            try {
              const kit = await getProductKit(it.productId);
              const rental = kit
                .flatMap((g) => g.items)
                .reduce((sum, i) => sum + (i.rentalPrice || 0), 0);
              return { ...it, rental };
            } catch {
              return { ...it, rental: 0 };
            }
          }
          return it;
        })
      );
      setItems(updated);
    }
    if (items.some((it) => it.type === "product" && typeof it.rental === "undefined")) {
      fillRental();
    }
  }, [items]);

  const addProduct = async (id: string) => {
    const prod = products.find((p) => p.id === id);
    if (prod) {
      let rental = 0;
      try {
        const kit = await getProductKit(id);
        rental = kit
          .flatMap((g) => g.items)
          .reduce((sum, i) => sum + (i.rentalPrice || 0), 0);
      } catch {}
      setItems((prev) => [
        ...prev,
        { type: "product", productId: id, name: prod.name, price: prod.price, rental },
      ]);
    }
  };
  const addCustom = () => setItems((prev) => [...prev, { type: "custom", name: "", price: 0 }]);
  const updateItem = (i: number, field: keyof ProposalItem, value: any) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it))
    );
  };
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const toggleAgreement = (id: string) => {
    setAgreementIds((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };
  const toggleSection = (id: string) => {
    setSectionIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const submit = async () => {
    try {
      const callable = httpsCallable(functions, "admin_createProposal");
      await callable({ orgId, clientEmail, items, agreementIds, sectionIds, templateId: templateId || undefined, customText });
      router.push("/admin/proposals");
    } catch (err: any) {
      alert(err.message || "Error creating proposal");
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!canManage) return <p>You do not have permission to create proposals.</p>;

  return (
    <div className="grid gap-6 max-w-3xl">
      <h1 className="text-xl font-semibold">New Proposal</h1>
      {step === 1 && (
        <div className="card p-4 grid gap-3">
          <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Select organisation</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
          </select>
          <input type="email" className="input" placeholder="Client email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <textarea className="input" placeholder="Intro / notes" value={customText} onChange={(e) => setCustomText(e.target.value)} />
          <div className="flex justify-end">
            <button className="btn" disabled={!orgId || !clientEmail} onClick={() => setStep(2)}>Next</button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="card p-4 grid gap-3">
          <div className="flex gap-2">
            <select className="input" onChange={(e) => { if (e.target.value) { addProduct(e.target.value); e.target.value=""; } }}>
              <option value="">Add product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn" onClick={addCustom}>Add Custom</button>
          </div>
          {items.length === 0 ? <p>No items added.</p> : (
            <div className="grid gap-2">
              {items.map((it, i) => (
                <div key={i} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    {it.type === "custom" ? (
                      <>
                        <input className="input flex-1" placeholder="Description" value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                        <input className="input w-24" type="number" value={it.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
                      </>
                    ) : (
                      <>
                        <span className="flex-1">{it.name}</span>
                        <span className="w-24 text-right">£{it.price}</span>
                        {typeof it.rental === "number" && (
                          <span className="w-24 text-right text-xs text-gray-500">
                            £{it.rental.toFixed(2)} rent
                          </span>
                        )}
                      </>
                    )}
                    <button className="btn-outline" onClick={() => removeItem(i)}>Remove</button>
                  </div>
                  {it.type === "product" && (
                    <textarea className="input" placeholder="Notes" value={it.notes || ""} onChange={(e) => updateItem(i, "notes", e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(1)}>Back</button>
            <button className="btn" onClick={() => setStep(3)}>Next</button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="card p-4 grid gap-3">
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
              <span>{s.title || s.id}</span>
            </label>
          ))}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(2)}>Back</button>
            <button className="btn" onClick={() => setStep(4)}>Next</button>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="card p-4 grid gap-3">
          {agreements.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input type="checkbox" checked={agreementIds.includes(a.id)} onChange={() => toggleAgreement(a.id)} />
              <span>{a.title || a.id}</span>
            </label>
          ))}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(3)}>Back</button>
            <button className="btn" onClick={() => setStep(5)}>Next</button>
          </div>
        </div>
      )}
      {step === 5 && (
        <div className="card p-4 grid gap-3">
          <p className="font-semibold">Review</p>
          <p>Organisation: {orgs.find((o) => o.id === orgId)?.name || orgId}</p>
          <p>Email: {clientEmail}</p>
          {items.length > 0 && (
            <ul className="list-disc pl-6">
              {items.map((it, i) => (
                <li key={i}>
                  {it.name} - £{it.price}
                  {typeof it.rental === "number" && it.rental > 0
                    ? ` (Rental £${it.rental.toFixed(2)})`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          {sectionIds.length > 0 && <p>Sections: {sectionIds.length}</p>}
          {agreementIds.length > 0 && (
            <p>Agreements: {agreementIds.length}</p>
          )}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(4)}>Back</button>
            <button className="btn" onClick={submit}>Create Proposal</button>
          </div>
        </div>
      )}
      <div>
        <Link href="/admin/proposals" className="link">Back to proposals</Link>
      </div>
    </div>
  );
}
