"use client";

import { useCart } from "@/lib/cart";
import { ensureFirebase } from "@/lib/firebase";
import { VAT_RATE } from "@/lib/vat";
import { httpsCallable, type Functions } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { signInWithEmailAndPassword, type Auth, type User } from "firebase/auth";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function CheckoutPage() {
  const { items, clear } = useCart();
  const productTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const rentalTotal = items.reduce(
    (sum, i) => sum + (i.rentalTotal || 0) * i.quantity,
    0
  );
  const total = productTotal + rentalTotal;
  const [discount, setDiscount] = useState(0);
  const discountAmount = productTotal * (discount / 100);
  const finalTotal = productTotal - discountAmount + rentalTotal;
  const vat = finalTotal * VAT_RATE;
  const grandTotal = finalTotal + vat;
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [projectName, setProjectName] = useState("");
  const [voucher, setVoucher] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const functionsRef = useRef<Functions | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db, functions } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || typeof auth.onAuthStateChanged !== "function" || !db) {
          throw new Error("Firebase auth or database is unavailable.");
        }

        authRef.current = auth;
        functionsRef.current = functions ?? null;

        unsubscribe = auth.onAuthStateChanged(async (user: User | null) => {
          if (cancelled) {
            return;
          }

          setCurrentUser(user);
          if (user) {
            try {
              setEmail(user.email || "");
              setName(user.displayName || "");
              const snap = await getDoc(doc(db, "users", user.uid));
              setDiscount((snap.data()?.discount as number) || 0);
            } catch (error) {
              console.error("Failed to load user discount", error);
              setDiscount(0);
            }
          } else {
            setDiscount(0);
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to initialise Firebase for checkout", error);
          setCurrentUser(null);
          setDiscount(0);
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    try {
      let instance = authRef.current;
      if (!instance) {
        const { auth } = await ensureFirebase();
        instance = auth ?? null;
        authRef.current = instance;
      }
      if (!instance) {
        throw new Error("Firebase auth is unavailable.");
      }
      await signInWithEmailAndPassword(instance, email, password);
    } catch (err) {
      console.error(err);
      alert("Login failed");
    }
  };

  const complete = async () => {
    const authInstance = authRef.current;
    const user = authInstance?.currentUser ?? currentUser;
    if (loading || items.length === 0 || !name || (!user && !email)) return;
    setLoading(true);
    try {
      const functionsInstance = functionsRef.current;
      if (!functionsInstance) {
        throw new Error("Firebase functions are unavailable.");
      }
      const createOrder = httpsCallable(functionsInstance, "createOrder");
      const orderRes: any = await createOrder({
        userEmail: user?.email || email,
        customerName: name,
        companyName: company || null,
        location: location || null,
        projectName: projectName || null,
        voucher: voucher || null,
        items: items.map((i) => ({
          id: i.id,
          quantity: i.quantity,
          rentalTotal: i.rentalTotal || 0,
          modifiers: i.modifiers || [],
        })),
        kitItems: items.flatMap((i) => i.kitItems || []),
        rentalSubtotal: rentalTotal,
      });
      const orderId = orderRes.data?.orderId;

      const createIntent = httpsCallable(functionsInstance, "stripe_createPaymentIntent");
      const res: any = await createIntent({ orderId, type: "deposit" });
      const clientSecret = res.data?.clientSecret;
      const stripe = await loadStripe(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
      );
      if (!stripe || !clientSecret) throw new Error("Payment failed");
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: "pm_card_visa",
      });
      if (result.error) throw result.error;

      clear();
      router.push(`/orders/${orderId}`);
    } catch (err) {
      console.error(err);
      alert("Could not complete order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
      <div className="space-y-6">
        {authReady && !currentUser && (
          <form onSubmit={login} className="space-y-2 border p-4 rounded">
            <h2 className="font-semibold">Login</h2>
            <input
              className="input input-bordered w-full"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="input input-bordered w-full"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn" type="submit">
              Sign In
            </button>
          </form>
        )}

        <div className="space-y-2">
          <h2 className="font-semibold">Customer Details</h2>
          {!currentUser && (
            <input
              className="input input-bordered w-full"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
          <input
            className="input input-bordered w-full"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input input-bordered w-full"
            placeholder="Company Name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            className="input input-bordered w-full"
            placeholder="Shooting Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <input
            className="input input-bordered w-full"
            placeholder="Project Name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold">Order Summary</h2>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="text-sm">
              <div className="flex justify-between">
                <span>
                  {item.name} x {item.quantity}
                </span>
                <span>£{(item.price * item.quantity).toFixed(2)}</span>
              </div>
              {item.rentalTotal ? (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Rental</span>
                  <span>£{(item.rentalTotal * item.quantity).toFixed(2)}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex justify-between font-semibold border-t pt-2">
          <span>Subtotal</span>
          <span>£{productTotal.toFixed(2)}</span>
        </div>
        {rentalTotal > 0 && (
          <div className="flex justify-between text-sm">
            <span>Rental Subtotal</span>
            <span>£{rentalTotal.toFixed(2)}</span>
          </div>
        )}
        {discount > 0 && (
          <div className="flex justify-between text-sm">
            <span>Discount ({discount}%)</span>
            <span>-£{discountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span>VAT (20%)</span>
          <span>£{vat.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>£{grandTotal.toFixed(2)}</span>
        </div>
        <input
          className="input input-bordered w-full"
          placeholder="Voucher code"
          value={voucher}
          onChange={(e) => setVoucher(e.target.value)}
        />
        <div className="border p-4 text-center text-sm text-gray-500">
          Stripe payment form placeholder
        </div>
        <button
          className="btn w-full"
          onClick={complete}
          disabled={
            loading ||
            items.length === 0 ||
            !name ||
            (!currentUser && !email)
          }
        >
          {loading ? "Processing..." : "Complete Order"}
        </button>
      </div>
    </div>
  );
}
