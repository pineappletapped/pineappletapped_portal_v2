"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import PortalContainer from "@/components/PortalContainer";
import AvailabilityCalendar, { AvailabilityStatus } from "@/components/AvailabilityCalendar";
import { auth, db, functions } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  addDoc,
  orderBy,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import ContractorProfileForm from "@/components/ContractorProfileForm";
import ContractorKitManager from "@/components/ContractorKitManager";
import { extractUserRoles, hasRole } from "@/lib/roles";

export default function ContractorPortal() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [availability, setAvailability] = useState<Record<string, AvailabilityStatus>>({});
  const [bookings, setBookings] = useState<any[]>([]);
  const [availableBookings, setAvailableBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "bookings" | "projects" | "profile" | "kit" | "notices"
  >("bookings");
  const [bookingTab, setBookingTab] = useState<"current" | "past" | "available">("current");
  const [notices, setNotices] = useState<any[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        const me = (uSnap.data() as any) || {};
        const profileDoc = {
          ...me,
          id: uSnap.id,
          uid: user.uid,
          email: me?.email ?? user.email ?? null,
        };
        const roles = extractUserRoles(profileDoc);
        setIsStaff(hasRole(roles, ["admin", "operations", "projects"]));

        const tq = query(collection(db, "contractorTasks"), where("uid", "==", user.uid));
        const tSnap = await getDocs(tq);
        setTasks(tSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const bq = query(collection(db, "bookings"), where("contractorUid", "==", user.uid));
        const bSnap = await getDocs(bq);
        setBookings(bSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const abq = query(collection(db, "bookings"), where("contractorUid", "==", null));
        const abSnap = await getDocs(abq);
        setAvailableBookings(abSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const aq = query(collection(db, "availability"), where("uid", "==", user.uid));
        const aSnap = await getDocs(aq);
        const map: Record<string, AvailabilityStatus> = {};
        aSnap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.date && data.status) map[data.date] = data.status;
        });
        setAvailability(map);

        const nSnap = await getDocs(
          query(collection(db, "teamNotices"), orderBy("createdAt", "desc"))
        );
        setNotices(nSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.warn("Failed to load contractor data", err);
      }
      setLoading(false);
    })();
  }, []);

  const markTaskComplete = async (id: string) => {
    try {
      const fn = httpsCallable(functions, "contractor_updateTask");
      await fn({ taskId: id, status: "submitted" });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "submitted" } : t)));
    } catch (err) {
      console.warn("markTaskComplete failed", err);
    }
  };

  const applyForBooking = async (id: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, "bookingApplications"), {
        bookingId: id,
        uid: user.uid,
        createdAt: Date.now(),
      });
      alert("Application sent");
    } catch (err) {
      console.warn("applyForBooking failed", err);
    }
  };

  const updateDay = async (date: string, status: AvailabilityStatus) => {
    const user = auth.currentUser;
    if (!user) return;
    setAvailability({ ...availability, [date]: status });
    await setDoc(doc(db, "availability", `${user.uid}_${date}`), {
      uid: user.uid,
      date,
      status,
    });
  };

  const submitNotice = async (e: FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !isStaff) return;
    try {
      await addDoc(collection(db, "teamNotices"), {
        title: noticeTitle,
        message: noticeMessage,
        createdAt: serverTimestamp(),
        authorUid: user.uid,
      });
      setNoticeTitle("");
      setNoticeMessage("");
      const nSnap = await getDocs(
        query(collection(db, "teamNotices"), orderBy("createdAt", "desc"))
      );
      setNotices(nSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn("submitNotice failed", err);
    }
  };

  if (loading)
    return (
      <PortalContainer>
        <p>Loading...</p>
      </PortalContainer>
    );

  return (
    <PortalContainer>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Contractor Portal</h1>
        <Link href="/admin/messages" className="text-orange underline">
          Messenger
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/contractors/workwear" className="btn-sm">
          Workwear hub
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          className={`${activeTab === "bookings" ? "btn" : "btn-outline"}`}
          onClick={() => setActiveTab("bookings")}
        >
          Bookings
        </button>
        <button
          className={`${activeTab === "projects" ? "btn" : "btn-outline"}`}
          onClick={() => setActiveTab("projects")}
        >
          Projects
        </button>
        <button
          className={`${activeTab === "profile" ? "btn" : "btn-outline"}`}
          onClick={() => setActiveTab("profile")}
        >
          Profile
        </button>
        <button
          className={`${activeTab === "kit" ? "btn" : "btn-outline"}`}
          onClick={() => setActiveTab("kit")}
        >
          Kit
        </button>
        <button
          className={`${activeTab === "notices" ? "btn" : "btn-outline"}`}
          onClick={() => setActiveTab("notices")}
        >
          Notices
        </button>
      </div>

      {activeTab === "bookings" && (
        <div className="md:flex gap-6">
          <div className="md:w-2/3">
            <div className="flex gap-2 mb-4">
              <button
                className={`btn-sm ${bookingTab === "current" ? "btn bg-blue" : "btn-outline border-blue text-blue hover:bg-blue hover:text-white"}`}
                onClick={() => setBookingTab("current")}
              >
                Current
              </button>
              <button
                className={`btn-sm ${bookingTab === "past" ? "btn bg-blue" : "btn-outline border-blue text-blue hover:bg-blue hover:text-white"}`}
                onClick={() => setBookingTab("past")}
              >
                Past
              </button>
              <button
                className={`btn-sm ${bookingTab === "available" ? "btn bg-blue" : "btn-outline border-blue text-blue hover:bg-blue hover:text-white"}`}
                onClick={() => setBookingTab("available")}
              >
                Available
              </button>
            </div>

            <div className="space-y-2">
              {bookingTab === "available"
                ? availableBookings.map((b) => (
                    <div key={b.id} className="border p-4 rounded">
                      <p className="font-medium">
                        {b.slot?.date} {b.slot?.start}-{b.slot?.end}
                      </p>
                      <button
                        className="btn-sm mt-2"
                        onClick={() => applyForBooking(b.id)}
                      >
                        Apply
                      </button>
                    </div>
                  ))
                : (bookingTab === "current"
                    ? bookings.filter((b) => {
                        const today = new Date().toISOString().split("T")[0];
                        return b.slot?.date >= today;
                      })
                    : bookings.filter((b) => {
                        const today = new Date().toISOString().split("T")[0];
                        return b.slot?.date < today;
                      })
                  ).map((b) => {
                    const color = b.tasksComplete
                      ? b.clientPaid
                        ? b.contractorPaid
                          ? "border-green-500"
                          : "border-blue-500"
                        : "border-yellow-400"
                      : "border-red-500";
                    return (
                      <div key={b.id} className={`border p-4 rounded ${color}`}>
                        <p className="font-medium">
                          {b.slot?.date} {b.slot?.start}-{b.slot?.end}
                        </p>
                        {bookingTab === "past" && (
                          <div className="flex gap-2 mt-2">
                            <button
                              className="btn-sm"
                              onClick={() => alert("Add invoice")}
                            >
                              Add Invoice
                            </button>
                            <button
                              className="btn-sm"
                              onClick={() => {
                                const note = prompt("Add notes", b.notes || "");
                                if (note) {
                                  setDoc(doc(db, "bookings", b.id), { notes: note }, { merge: true });
                                }
                              }}
                            >
                              Add Notes
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

              {bookingTab !== "available" &&
                (bookingTab === "current"
                  ? bookings.filter((b) => {
                      const today = new Date().toISOString().split("T")[0];
                      return b.slot?.date >= today;
                    })
                  : bookings.filter((b) => {
                      const today = new Date().toISOString().split("T")[0];
                      return b.slot?.date < today;
                    })).length === 0 && <p>No bookings.</p>}

              {bookingTab === "available" &&
                availableBookings.length === 0 && <p>No openings.</p>}
            </div>
          </div>
          <div className="md:flex-1 mt-6 md:mt-0">
            <h2 className="text-xl font-semibold mb-2">Availability</h2>
            <AvailabilityCalendar availability={availability} onChange={updateDay} />
          </div>
        </div>
      )}

      {activeTab === "projects" && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Assigned Tasks</h2>
          {tasks.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {tasks.map((task) => (
                <div key={task.id} className="border rounded p-4">
                  <h3 className="font-medium mb-1">{task.title || "Task"}</h3>
                  <p className="text-sm mb-2">Status: {task.status}</p>
                  {task.status !== "submitted" && (
                    <button
                      className="btn-outline text-sm"
                      onClick={() => markTaskComplete(task.id)}
                    >
                      Mark Complete
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p>No tasks assigned.</p>
          )}
        </div>
      )}

      {activeTab === "profile" && (
        <div className="space-y-4">
          <p className="mb-2">Logged in as {auth.currentUser?.email}</p>
          <ContractorProfileForm />
        </div>
      )}

      {activeTab === "kit" && <ContractorKitManager />}

      {activeTab === "notices" && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Team Notice Board</h2>
          {isStaff && (
            <form onSubmit={submitNotice} className="mb-4 space-y-2">
              <input
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                placeholder="Title"
                className="input w-full"
              />
              <textarea
                value={noticeMessage}
                onChange={(e) => setNoticeMessage(e.target.value)}
                placeholder="Message"
                className="textarea w-full"
              />
              <button type="submit" className="btn">
                Post Notice
              </button>
            </form>
          )}
          <div className="space-y-2">
            {notices.map((n) => (
              <div key={n.id} className="border rounded p-4">
                <p className="font-medium">{n.title}</p>
                <p className="text-sm text-gray-600 whitespace-pre-line">{n.message}</p>
              </div>
            ))}
            {notices.length === 0 && <p>No notices.</p>}
          </div>
        </div>
      )}
    </PortalContainer>
  );
}

