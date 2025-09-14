"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  multiple: boolean;
  options: ModifierOption[];
}

export default function ModifiersPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [newName, setNewName] = useState("");
  const [newMultiple, setNewMultiple] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsStaff(false);
        setLoading(false);
        return;
      }
      const meSnap = await getDoc(doc(db, "users", user.uid));
      const me = meSnap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const snap = await getDocs(collection(db, "modifiers"));
        setGroups(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any
        );
      }
      setLoading(false);
    })();
  }, []);

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const docRef = await addDoc(collection(db, "modifiers"), {
      name: newName,
      multiple: newMultiple,
      options: [],
    });
    setGroups((g) => [
      ...g,
      { id: docRef.id, name: newName, multiple: newMultiple, options: [] },
    ]);
    setNewName("");
    setNewMultiple(false);
  };

  const addOption = async (
    groupId: string,
    name: string,
    price: string,
    reset: () => void
  ) => {
    const option: ModifierOption = {
      id: crypto.randomUUID(),
      name,
      price: Number(price) || 0,
    };
    const ref = doc(db, "modifiers", groupId);
    const group = groups.find((g) => g.id === groupId);
    const opts = [...(group?.options || []), option];
    await updateDoc(ref, { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
    reset();
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage modifiers.</p>;

  return (
    <div className="grid gap-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Modifiers</h1>
      <form onSubmit={addGroup} className="grid gap-2 border p-4 rounded">
        <input
          className="input"
          placeholder="Group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newMultiple}
            onChange={(e) => setNewMultiple(e.target.checked)}
          />
          Allow multiple selections
        </label>
        <button type="submit" className="btn btn-sm w-fit">
          Add Group
        </button>
      </form>
      <div className="grid gap-4">
        {groups.map((g) => (
          <div key={g.id} className="border p-4 rounded grid gap-2">
            <div>
              <h2 className="font-semibold">{g.name}</h2>
              <p className="text-sm text-gray-600">
                {g.multiple ? "Checkboxes" : "Radio"}
              </p>
            </div>
            <ul className="grid gap-1">
              {g.options.map((o) => (
                <li key={o.id}>
                  {o.name} – £{o.price.toFixed(2)}
                </li>
              ))}
            </ul>
            <OptionForm groupId={g.id} onAdd={addOption} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OptionForm({
  groupId,
  onAdd,
}: {
  groupId: string;
  onAdd: (groupId: string, name: string, price: string, reset: () => void) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(groupId, name, price, () => {
          setName("");
          setPrice("0");
        });
      }}
      className="grid gap-2 mt-2"
    >
      <input
        className="input"
        placeholder="Option name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
      type="number"
      className="input"
      placeholder="Price"
      value={price}
      onChange={(e) => setPrice(e.target.value)}
      />
      <button type="submit" className="btn btn-sm w-fit">
        Add Option
      </button>
    </form>
  );
}
