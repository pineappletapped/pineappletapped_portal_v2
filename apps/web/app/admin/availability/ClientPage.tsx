"use client";

import { useEffect, useState } from "react";
import AvailabilityCalendar, { AvailabilityStatus } from "@/components/AvailabilityCalendar";
import { db } from "@/lib/firebase";
import { doc, collection, query, where, getDocs, setDoc } from "firebase/firestore";
import { adminListUsers } from "@/lib/admin";
import { useRoleGate } from "@/hooks/useRoleGate";

interface User {
  id: string;
  displayName?: string;
  email: string;
}

export default function AdminAvailabilityPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["projects", "operations"]);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [availability, setAvailability] = useState<Record<string, AvailabilityStatus>>({});
  const [loadingMembers, setLoadingMembers] = useState(true);

  // load staff status and team list
  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoadingMembers(false);
        return;
      }
      try {
        const result: any = await adminListUsers();
        const users: User[] = result.users || [];
        setMembers(users);
        const def =
          users.find((u) => u.email === "ryan@pineappletapped.com") || users[0];
        if (def) setSelected(def.id);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [allowed, guardLoading]);

  // load availability for selected member
  useEffect(() => {
    if (!allowed || !selected) return;
    (async () => {
      const q = query(collection(db, "availability"), where("uid", "==", selected));
      const snap = await getDocs(q);
      const map: Record<string, AvailabilityStatus> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (data.date && data.status) map[data.date] = data.status;
      });
      setAvailability(map);
    })();
  }, [allowed, selected]);

  const updateDay = async (date: string, status: AvailabilityStatus) => {
    setAvailability({ ...availability, [date]: status });
    await setDoc(doc(db, "availability", `${selected}_${date}`), {
      uid: selected,
      date,
      status,
    });
  };

  if (guardLoading || loadingMembers) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage availability.</p>;

  return (
    <div className="flex gap-6">
      <div className="w-64 space-y-2">
        <h1 className="text-xl font-semibold mb-4">Team Members</h1>
        {members.map((m) => (
          <button
            key={m.id}
            className={`block w-full text-left p-2 rounded border ${
              selected === m.id ? "bg-blue-100" : "bg-white"
            }`}
            onClick={() => setSelected(m.id)}
          >
            {m.displayName || m.email}
          </button>
        ))}
      </div>
      <div className="flex-1">
        <h1 className="text-xl font-semibold mb-4">Manage Availability</h1>
        {selected ? (
          <AvailabilityCalendar availability={availability} onChange={updateDay} />
        ) : (
          <p>Select a team member to view availability.</p>
        )}
      </div>
    </div>
  );
}

