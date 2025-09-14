/*
 * Script to import products into Firestore.
 *
 * This helper script reads the generated `product_catalog.json` and writes
 * each product into the `products` collection of your Firestore database.
 * To execute, run:
 *
 *   node scripts/importProducts.js
 *
 * Make sure to set the following environment variables before running:
 *   - GOOGLE_APPLICATION_CREDENTIALS: Path to your Firebase service account key
 *   - PROJECT_ID: Your Firebase project ID (used for Firestore initialization)
 *
 * The script uses the Firebase Admin SDK to connect to Firestore. If you
 * deploy this project with Supabase or another backend, adjust accordingly.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('Please set GOOGLE_APPLICATION_CREDENTIALS environment variable to your service account key file');
  process.exit(1);
}
const projectId = process.env.PROJECT_ID;
if (!projectId) {
  console.error('Please set PROJECT_ID environment variable to your Firebase project ID');
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  projectId,
});

const db = admin.firestore();

async function importProducts() {
  const catalogPath = path.join(__dirname, '..', 'data', 'product_catalog.json');
  if (!fs.existsSync(catalogPath)) {
    console.error(`catalog file not found at ${catalogPath}`);
    process.exit(1);
  }
  const products = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  console.log(`Importing ${products.length} products...`);
  for (const product of products) {
    const docRef = db.collection('products').doc();
    // Flatten categories into a single string for convenience
    const categories = product.categories || [];
    try {
      await docRef.set({
        name: product.name,
        variation: product.variation || null,
        sku: product.sku || null,
        handle: product.handle || null,
        description: product.description || '',
        categories,
        price: product.price || null,
        salePrice: product.salePrice || null,
        modifiers: product.modifiers || [],
        image: product.image || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Imported ${product.name}`);
    } catch (err) {
      console.error('Failed to import', product.name, err);
    }
  }
  console.log('Import complete');
  process.exit(0);
}

importProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});
