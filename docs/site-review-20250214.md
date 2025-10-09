# Pineapple Tapped Portal – Hosted Site Review

Hosted instance reviewed: https://ptfbportalbackend--pineapple-tapped---portal.us-central1.hosted.app/

## Observations
- The homepage hero and workflow process sections still rely on the hard-coded fallback copy and dummy imagery (`dummyimage.com`) defined in the app, which shows up verbatim on the hosted build.
- Product, service category, blog, and client logo modules all fall back to baked-in sample data when Firestore cannot be reached. The hosted build surfaces these placeholders (e.g., `/placeholder.jpg` art, lorem-style descriptions), indicating the production Firestore content has not been wired up.

## Tasks to Complete
1. **Connect homepage content to Firestore** – Replace the `sampleHomepage` fallback with live records (or ensure Firestore is reachable in production) so the hero headline, CTA, and process content are managed dynamically instead of pointing at dummy `dummyimage.com` assets.【F:apps/web/lib/homepage.ts†L48-L138】
2. **Source product catalogue from Firestore** – Update the hosted build to successfully load products instead of dropping to `sampleProducts`, which currently renders `/placeholder.jpg` thumbnails and mock pricing copy.【F:apps/web/lib/products.ts†L762-L893】
3. **Load service categories from Firestore** – Ensure `getCategories` and related helpers return the live category tree so navigation art and descriptions are accurate rather than the `sampleCategories` definitions with placeholder hero images.【F:apps/web/lib/categories.ts†L62-L143】
4. **Publish real blog content** – Populate `blogPosts` and `blogCategories` collections (or fix access) so `getPosts` and `getCategories` avoid the static `samplePosts`/`sampleCategories`, eliminating the placeholder articles currently shown on the hosted blog section.【F:apps/web/lib/blog.ts†L108-L364】
5. **Replace client logo carousel placeholders** – Connect `clientLogos` Firestore documents so the carousel uses real partner artwork instead of the `/placeholder.jpg` entries from `sampleLogos`.【F:apps/web/lib/clientLogos.ts†L58-L85】

## Next Steps
- Verify Firestore credentials and rules for the production environment.
- Seed the necessary collections with real content and media assets.
- Remove or minimise the baked-in fallback sample data once live content is confirmed to load reliably.
