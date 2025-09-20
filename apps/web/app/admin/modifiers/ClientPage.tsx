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
  deleteDoc,
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
    const trimmed = name.trim();
    if (!trimmed) return;
    const option: ModifierOption = {
      id: crypto.randomUUID(),
      name: trimmed,
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

  const updateGroupMeta = async (
    groupId: string,
    name: string,
    multiple: boolean
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateDoc(doc(db, "modifiers", groupId), {
      name: trimmed,
      multiple,
    });
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId ? { ...g, name: trimmed, multiple } : g
      )
    );
  };

  const removeGroup = async (groupId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Are you sure you want to delete this modifier group?"
      );
      if (!confirmed) return;
    }
    await deleteDoc(doc(db, "modifiers", groupId));
    setGroups((gs) => gs.filter((g) => g.id !== groupId));
  };

  const updateOption = async (
    groupId: string,
    optionId: string,
    data: { name: string; price: number }
  ) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const opts = group.options.map((o) =>
      o.id === optionId ? { ...o, ...data } : o
    );
    await updateDoc(doc(db, "modifiers", groupId), { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
  };

  const removeOption = async (groupId: string, optionId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this option?");
      if (!confirmed) return;
    }
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const opts = group.options.filter((o) => o.id !== optionId);
    await updateDoc(doc(db, "modifiers", groupId), { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
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
          <ModifierGroupCard
            key={g.id}
            group={g}
            onAddOption={addOption}
            onUpdateGroup={updateGroupMeta}
            onDeleteGroup={removeGroup}
            onUpdateOption={updateOption}
            onDeleteOption={removeOption}
          />
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
      className="grid gap-2 rounded border border-dashed p-3"
    >
      <h3 className="text-sm font-medium">Add option</h3>
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

function EditableOptionRow({
  groupId,
  option,
  onUpdate,
  onDelete,
}: {
  groupId: string;
  option: ModifierOption;
  onUpdate: (groupId: string, optionId: string, data: { name: string; price: number }) => void;
  onDelete: (groupId: string, optionId: string) => void;
}) {
  const [name, setName] = useState(option.name);
  const [price, setPrice] = useState(option.price.toString());
  useEffect(() => {
    setName(option.name);
    setPrice(option.price.toString());
  }, [option.id, option.name, option.price]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onUpdate(groupId, option.id, {
          name: name.trim(),
          price: Number(price) || 0,
        });
      }}
      className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
    >
      <input
        className="input flex-1 min-w-[160px]"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        type="number"
        className="input w-24"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-sm w-fit">
          Save
        </button>
        <button
          type="button"
          className="btn btn-sm w-fit bg-red-600 text-white"
          onClick={() => onDelete(groupId, option.id)}
        >
          Delete
        </button>
      </div>
    </form>
  );
}

function ModifierGroupCard({
  group,
  onAddOption,
  onUpdateGroup,
  onDeleteGroup,
  onUpdateOption,
  onDeleteOption,
}: {
  group: ModifierGroup;
  onAddOption: (groupId: string, name: string, price: string, reset: () => void) => void;
  onUpdateGroup: (groupId: string, name: string, multiple: boolean) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateOption: (groupId: string, optionId: string, data: { name: string; price: number }) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [multiple, setMultiple] = useState(group.multiple);
  useEffect(() => {
    setName(group.name);
    setMultiple(group.multiple);
  }, [group.id, group.name, group.multiple]);

  return (
    <div className="border p-4 rounded grid gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onUpdateGroup(group.id, name, multiple);
        }}
        className="grid gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            className="input flex-1 min-w-[180px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => setMultiple(e.target.checked)}
              />
              Allow multiple
            </label>
            <button type="submit" className="btn btn-sm w-fit">
              Save
            </button>
            <button
              type="button"
              className="btn btn-sm w-fit bg-red-600 text-white"
              onClick={() => onDeleteGroup(group.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </form>
      <div className="grid gap-2">
        {group.options.length === 0 ? (
          <p className="text-sm text-gray-600">No options yet.</p>
        ) : (
          group.options.map((option) => (
            <EditableOptionRow
              key={option.id}
              groupId={group.id}
              option={option}
              onUpdate={onUpdateOption}
              onDelete={onDeleteOption}
            />
          ))
        )}
      </div>
      <OptionForm groupId={group.id} onAdd={onAddOption} />
    </div>
  );
}
