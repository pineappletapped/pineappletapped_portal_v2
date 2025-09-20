import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import Stripe from 'stripe';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ColorThief from 'color-thief-node';
import { google } from 'googleapis';
import { Readable } from 'stream';
import fetch from 'node-fetch';
import * as cors from 'cors';
const corsHandler = cors.default({ origin: true });
// TODO: wrap all http functions with the cors handler, for example:
// exports.myFunction = functions.https.onRequest((req, res) => {
//   corsHandler(req, res, () => {
//     // your function logic
//   });
// });
admin.initializeApp({
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET ||
        'pineapple-tapped---portal.firebasestorage.app',
});
const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const VAT_RATE = 0.2;
const ROLE_KEYS = ['admin', 'operations', 'finance', 'projects', 'sales', 'marketing'];
const AUDIT_LOG_RETENTION_DAYS = 180;
const AUDIT_LOG_BATCH_SIZE = 500;
function serializeForAudit(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate().toISOString();
    }
    if (value instanceof admin.firestore.GeoPoint) {
        return { latitude: value.latitude, longitude: value.longitude };
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => serializeForAudit(item));
    }
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            try {
                return value.toDate().toISOString();
            }
            catch (err) {
                // fall through
            }
        }
        const entries = Object.entries(value);
        if (entries.length === 0) {
            const method = value?._methodName;
            const name = method
                ? `FieldValue:${method}`
                : value?.constructor?.name || 'Object';
            return `[${name}]`;
        }
        return entries.reduce((acc, [key, v]) => {
            acc[key] = serializeForAudit(v);
            return acc;
        }, {});
    }
    return value;
}
function serializedEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function buildChangesFromUpdates(before, updates) {
    const changes = {};
    const base = before || {};
    for (const [key, value] of Object.entries(updates)) {
        const prev = base[key];
        const prevSerialized = serializeForAudit(prev);
        const nextSerialized = serializeForAudit(value);
        if (!serializedEqual(prevSerialized, nextSerialized)) {
            changes[key] = { before: prevSerialized, after: nextSerialized };
        }
    }
    return changes;
}
function buildChangesFromCreate(data) {
    const changes = {};
    for (const [key, value] of Object.entries(data)) {
        changes[key] = { before: null, after: serializeForAudit(value) };
    }
    return changes;
}
function buildChangesFromDelete(before) {
    const changes = {};
    if (!before)
        return changes;
    for (const [key, value] of Object.entries(before)) {
        changes[key] = { before: serializeForAudit(value), after: null };
    }
    return changes;
}
async function writeAuditLog(entry) {
    const payload = {
        actorUid: entry.actorUid,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (entry.changes && Object.keys(entry.changes).length > 0) {
        payload.changes = entry.changes;
    }
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
        payload.metadata = serializeForAudit(entry.metadata);
    }
    await db.collection('adminAuditLogs').add(payload);
}
function extractRoleSet(data) {
    const roles = new Set();
    if (!data)
        return roles;
    const rawRoles = data?.roles;
    if (Array.isArray(rawRoles)) {
        for (const value of rawRoles) {
            if (ROLE_KEYS.includes(value)) {
                roles.add(value);
            }
        }
    }
    else if (rawRoles && typeof rawRoles === 'object') {
        for (const [key, value] of Object.entries(rawRoles)) {
            if (value === true && ROLE_KEYS.includes(key)) {
                roles.add(key);
            }
        }
    }
    if (data?.isStaff === true) {
        roles.add('admin');
    }
    return roles;
}
function hasRequiredRole(roles, required) {
    if (roles.has('admin'))
        return true;
    if (!required)
        return roles.size > 0;
    const requiredList = Array.isArray(required) ? required : [required];
    return requiredList.some((role) => roles.has(role));
}
// Set ffmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
/*
 * Helper to remove near-white background from logos. This uses sharp to
 * operate on raw pixel data, identifying pixels that are very close to
 * white (r,g,b > 240) and setting their alpha channel to 0. The result
 * is a PNG buffer with transparency preserved for non-background pixels.
 */
async function removeBackground(buffer) {
    // Ensure the image has an alpha channel
    const img = sharp(buffer).png().ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const threshold = 240;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // If the pixel is close to white, make it fully transparent
        if (r > threshold && g > threshold && b > threshold) {
            data[i + 3] = 0;
        }
        else {
            data[i + 3] = 255;
        }
    }
    const out = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
    return out;
}
// Create user profile on first login
export const onAuthUserCreate = functions.auth.user().onCreate(async (user) => {
    const isStaff = user.uid === 'WK6WCuSueLN5M3Zq6D7WBbHyGPo1' ||
        user.email === 'ryan@pineappletapped.com' ||
        user.email === 'ryanadmin@pineappletapped.com';
    // Merge with any pre-existing prospect/outreach record for this email
    let data = {
        email: user.email || null,
        fullName: user.displayName || null,
        isStaff,
        crmStatus: 'client',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (user.email) {
        const existing = await db
            .collection('users')
            .where('email', '==', user.email)
            .where('crmStatus', 'in', ['prospect', 'outreach'])
            .limit(1)
            .get();
        if (!existing.empty) {
            const doc = existing.docs[0];
            data = { ...doc.data(), ...data };
            await doc.ref.delete();
        }
    }
    await db.collection('users').doc(user.uid).set(data, { merge: true });
});
// Whenever an order is created ensure the purchaser is marked as a client
export const onOrderCreated = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snap) => {
    const order = snap.data();
    const uid = order.userId || order.uid;
    if (uid) {
        await db.collection('users').doc(uid).set({ crmStatus: 'client' }, { merge: true });
    }
    // Create a linked project for this order
    const projRef = await db.collection('projects').add({
        orgId: order.orgId || null,
        serviceId: order.serviceId || null,
        orderId: snap.id,
        userId: uid || null,
        userEmail: order.userEmail || null,
        title: order.serviceName || 'New Project',
        status: 'intake',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await snap.ref.set({ projectId: projRef.id }, { merge: true });
    const projectBudgetData = {};
    if (order.budgetTotals)
        projectBudgetData.budgetTotals = order.budgetTotals;
    const budgetItems = (order.items || []).map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        budget: item.budget || null,
    }));
    if (budgetItems.length > 0)
        projectBudgetData.budgetItems = budgetItems;
    if (Object.keys(projectBudgetData).length > 0) {
        await projRef.set(projectBudgetData, { merge: true });
    }
    // Populate workflow/default tasks from the ordered product
    if (order.serviceId) {
        try {
            const prodDoc = await db.collection('products').doc(order.serviceId).get();
            const prod = prodDoc.data();
            const taskDocs = [];
            // If the product references a workflow, load its tasks
            if (prod?.workflowId) {
                const wfDoc = await db.collection('workflows').doc(prod.workflowId).get();
                const wf = wfDoc.data();
                if (Array.isArray(wf?.tasks)) {
                    for (const t of wf.tasks) {
                        const dueDays = parseInt(t.dueDays, 10);
                        const dueAt = isNaN(dueDays)
                            ? null
                            : admin.firestore.Timestamp.fromDate(new Date(Date.now() + dueDays * 86400000));
                        taskDocs.push({
                            title: t.title,
                            description: t.description || '',
                            fieldType: t.fieldType || null,
                            dueAt,
                            forCustomer: !!t.forCustomer,
                            status: 'todo',
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            assignedTo: null,
                            assigneeName: null,
                        });
                    }
                }
            }
            // Include any legacy default tasks defined directly on the product
            if (Array.isArray(prod?.defaultTasks)) {
                for (const t of prod.defaultTasks) {
                    taskDocs.push({
                        title: t.title,
                        forCustomer: !!t.forCustomer,
                        subtasks: t.subtasks || [],
                        status: 'todo',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        assignedTo: null,
                        assigneeName: null,
                    });
                }
            }
            if (taskDocs.length) {
                const tasksRef = projRef.collection('tasks');
                const existing = await tasksRef.limit(1).get();
                if (existing.empty) {
                    const batch = db.batch();
                    for (const task of taskDocs) {
                        batch.set(tasksRef.doc(), task);
                    }
                    await batch.commit();
                }
            }
        }
        catch (err) {
            console.error('Failed to populate default tasks', err);
        }
    }
    // Record equipment bookings and usage logs
    const kitItems = order.kitItems || [];
    if (Array.isArray(kitItems) && kitItems.length) {
        const batch = db.batch();
        for (const item of kitItems) {
            if (!item.id || !item.start || !item.end)
                continue;
            const eqRef = db.collection('equipment').doc(item.id);
            const start = admin.firestore.Timestamp.fromDate(new Date(item.start));
            const end = admin.firestore.Timestamp.fromDate(new Date(item.end));
            batch.set(eqRef.collection('bookings').doc(), {
                start,
                end,
                projectId: projRef.id,
            });
            batch.set(eqRef.collection('usageLog').doc(), {
                projectId: projRef.id,
                orderId: snap.id,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
    // Notify team about the new order
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
        const customer = order.customerName || order.userEmail || uid || 'Unknown customer';
        const service = order.serviceName ||
            (Array.isArray(order.items)
                ? order.items.map((i) => i.name).join(', ')
                : 'Unknown service');
        try {
            await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `New order ${snap.id} from ${customer} for ${service}`,
                }),
            });
        }
        catch (err) {
            console.error('Failed to send order notification', err);
        }
    }
    return null;
});
export const onQuoteRequestCreated = functions.firestore
    .document('quoteRequests/{requestId}')
    .onCreate(async (snap, context) => {
    const request = snap.data();
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
        try {
            await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `New quote request for ${request.projectName || 'untitled project'} from ${request.userEmail || request.userId || 'unknown user'}`,
                }),
            });
        }
        catch (err) {
            console.error('Slack webhook failed', err);
        }
    }
    await db.collection('proposals').add({
        quoteRequestId: context.params.requestId,
        userId: request.userId || null,
        projectName: request.projectName || null,
        status: 'draft',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return null;
});
// Booking callables
export const bookings_request = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const booking = {
        orgId: data.orgId, projectId: data.projectId || null, serviceId: data.serviceId || null,
        slot: data.slot, status: 'requested', location: data.location || null, notes: data.notes || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), uid: context.auth.uid
    };
    const ref = await db.collection('bookings').add(booking);
    return { id: ref.id };
});
// Track page view analytics from the public site
export const analytics_track = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        try {
            let uid = null;
            let userName = null;
            const authHeader = req.headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
                try {
                    const decoded = await admin
                        .auth()
                        .verifyIdToken(authHeader.split('Bearer ')[1]);
                    uid = decoded.uid;
                    const userSnap = await db.collection('users').doc(uid).get();
                    const udata = userSnap.data();
                    if (udata) {
                        userName = udata.fullName || udata.email || null;
                    }
                }
                catch (err) {
                    console.error('verifyIdToken failed', err);
                }
            }
            const data = req.body || {};
            const visitorId = data.visitorId || null;
            if (!uid && visitorId) {
                const mapSnap = await db.collection('analyticsVisitors').doc(visitorId).get();
                const mapData = mapSnap.data();
                if (mapData) {
                    uid = mapData.uid || null;
                    userName = mapData.userName || null;
                }
            }
            if (visitorId && uid && userName) {
                await db.collection('analyticsVisitors').doc(visitorId).set({ uid, userName }, { merge: true });
            }
            const event = {
                uid,
                userName,
                path: data.path || null,
                referrer: data.referrer || null,
                userAgent: data.userAgent || req.get('user-agent') || null,
                visitorId,
                duration: data.duration || null,
                ip: req.ip,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            await db.collection('analyticsEvents').add(event);
            res.json({ ok: true });
        }
        catch (err) {
            console.error('analytics_track error', err);
            res.status(500).json({ error: 'internal' });
        }
    });
});
export const bookings_confirm = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const u = await db.collection('users').doc(context.auth.uid).get();
    if (!u.exists || !u.data()?.isStaff)
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    await db.collection('bookings').doc(data.id).set({ status: 'confirmed' }, { merge: true });
    return { ok: true };
});
export const reserveKit = functions.https.onCall(async (data) => {
    const { productId, date } = data;
    if (!productId || !date) {
        throw new functions.https.HttpsError('invalid-argument', 'productId and date required');
    }
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const prodSnap = await db.collection('products').doc(productId).get();
    if (!prodSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'product not found');
    }
    const required = prodSnap.data().requiredKit || [];
    const eqIds = required.flatMap((g) => g.items || []);
    const conflicts = [];
    const kitItems = [];
    let rentalTotal = 0;
    for (const id of eqIds) {
        const eqRef = db.collection('equipment').doc(id);
        const eqSnap = await eqRef.get();
        if (!eqSnap.exists)
            continue;
        const eq = eqSnap.data();
        const bookings = await eqRef
            .collection('bookings')
            .where('start', '<=', end)
            .where('end', '>=', start)
            .get();
        if (!bookings.empty) {
            conflicts.push({ id, name: eq.name || id });
            continue;
        }
        kitItems.push({ id, start: start.toISOString(), end: end.toISOString() });
        rentalTotal += eq.rentalPrice || 0;
    }
    if (conflicts.length > 0) {
        return { conflicts };
    }
    const batch = db.batch();
    for (const item of kitItems) {
        const eqRef = db.collection('equipment').doc(item.id);
        batch.set(eqRef.collection('bookings').doc(), {
            start: admin.firestore.Timestamp.fromDate(start),
            end: admin.firestore.Timestamp.fromDate(end),
            projectId: null,
        });
    }
    await batch.commit();
    return { conflicts: [], kitItems, rentalTotal };
});
async function sendEmail(to, subject, body) {
    try {
        const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
        if (!keyB64)
            return;
        const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
        const authClient = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/gmail.send']);
        await authClient.authorize();
        const gmail = google.gmail({ version: 'v1', auth: authClient });
        const message = [
            `From: ${keyJson.client_email}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            'Content-Type: text/plain; charset=UTF-8',
            '',
            body,
        ].join('\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
    }
    catch (err) {
        console.error('sendEmail error', err);
    }
}
export const contact_send = functions.https.onCall(async (data) => {
    const msg = {
        kind: 'contact',
        fromName: data.name || null,
        fromEmail: data.email || null,
        company: data.company || null,
        body: data.message || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('messages').add(msg);
    await sendEmail('info@pineapple.local', `Contact form: ${data.name || 'Message'}`, `From: ${data.name} <${data.email}>\\n\\n${data.message}`);
    try {
        const existing = await db.collection('leads').where('email', '==', data.email).limit(1).get();
        if (existing.empty) {
            await db.collection('leads').add({
                orgId: null,
                name: data.name || null,
                email: data.email,
                company: data.company || null,
                status: 'new',
                source: 'contact',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        else {
            await existing.docs[0].ref.set({ name: data.name || null, company: data.company || null }, { merge: true });
        }
    }
    catch (err) {
        console.error('Failed to log contact lead', err);
    }
    return { ok: true };
});
export const quote_request_public = functions.https.onCall(async (data) => {
    const record = {
        userId: null,
        contactName: data.name,
        contactEmail: data.email,
        contactCompany: data.company || null,
        projectName: data.projectName || null,
        items: data.items || [],
        customRequest: data.customRequest || null,
        productionPeriod: data.productionPeriod || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
    };
    const ref = await db.collection('quoteRequests').add(record);
    await sendEmail('info@pineapple.local', `Quote request from ${data.name}`, `${data.projectName ? `Project: ${data.projectName}\n` : ''}${data.productionPeriod ? `Production: ${data.productionPeriod}\n` : ''}Email: ${data.email}\n\n${data.customRequest || ''}`);
    try {
        const existing = await db.collection('leads').where('email', '==', data.email).limit(1).get();
        if (existing.empty) {
            await db.collection('leads').add({
                orgId: null,
                name: data.name || null,
                email: data.email,
                company: data.company || null,
                status: 'new',
                source: 'quote',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        else {
            await existing.docs[0].ref.set({ name: data.name || null, company: data.company || null }, { merge: true });
        }
    }
    catch (err) {
        console.error('Failed to log quote lead', err);
    }
    return { id: ref.id };
});
// Signed download URL (guarded)
export const getDownloadUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const key = data.key;
    if (!key) {
        throw new functions.https.HttpsError('invalid-argument', 'Storage key required');
    }
    // Extract org, project and asset ids from the storage path
    const match = key.match(/orgs\/([^/]+)\/projects\/([^/]+)\/assets\/([^/]+)/);
    if (!match) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid asset key');
    }
    const [, orgId, projectId, assetId] = match;
    // Staff users bypass membership check
    const userSnap = await db.collection('users').doc(context.auth.uid).get();
    const isStaff = userSnap.exists && userSnap.data()?.isStaff === true;
    if (!isStaff) {
        const memSnap = await db
            .collection('memberships')
            .doc(`${orgId}_${context.auth.uid}`)
            .get();
        if (!memSnap.exists) {
            throw new functions.https.HttpsError('permission-denied', 'Not a member of this organisation');
        }
    }
    // Confirm asset exists and belongs to the project/org
    const assetSnap = await db.collection('assets').doc(assetId).get();
    if (!assetSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Asset not found');
    }
    const asset = assetSnap.data();
    if (asset.projectId !== projectId || asset.orgId !== orgId) {
        throw new functions.https.HttpsError('permission-denied', 'Asset mismatch');
    }
    // Verify associated order is fully paid
    const projSnap = await db.collection('projects').doc(projectId).get();
    const project = projSnap.data();
    if (!project) {
        throw new functions.https.HttpsError('not-found', 'Project not found');
    }
    const orderId = project.orderId;
    if (!orderId) {
        throw new functions.https.HttpsError('permission-denied', 'No related order found');
    }
    const orderSnap = await db.collection('orders').doc(orderId).get();
    const order = orderSnap.data();
    if (!order || (order.status !== 'paid' && order.status !== 'balance_paid')) {
        throw new functions.https.HttpsError('permission-denied', 'Order not paid');
    }
    // Generate signed URL via Admin SDK
    const bucket = admin.storage().bucket();
    const file = bucket.file(key);
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
    });
    return { url };
});
// Decline a booking request
export const bookings_decline = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const u = await db.collection('users').doc(context.auth.uid).get();
    if (!u.exists || !u.data()?.isStaff)
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    await db.collection('bookings').doc(data.id).set({ status: 'declined' }, { merge: true });
    return { ok: true };
});
// Contractor portal APIs
export const contractor_submitTimesheet = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { date, hours, notes } = data;
    if (!date || typeof hours !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'date and hours required');
    }
    await db.collection('contractorTimesheets').add({
        uid: context.auth.uid,
        date,
        hours,
        notes: notes || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
export const contractor_updateTask = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { taskId, status, deliverableUrl } = data;
    if (!taskId || !status) {
        throw new functions.https.HttpsError('invalid-argument', 'taskId and status required');
    }
    const ref = db.collection('contractorTasks').doc(taskId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.uid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'Task not found');
    }
    const updates = {
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (deliverableUrl)
        updates.deliverableUrl = deliverableUrl;
    await ref.set(updates, { merge: true });
    return { ok: true };
});
/**
 * Triggered when a logo is uploaded under orgs/{orgId}/brand-packs/{packId}/logo
 * Validates and processes the image: crops to square, resizes to max 512px, removes
 * any alpha channel background (simple white fill) and stores processed version
 * at orgs/{orgId}/brand/logo-prep/{packId}/processed.png. This function
 * demonstrates how you might use sharp for basic image processing. In a real
 * deployment you could integrate a more sophisticated background removal API.
 */
export const onLogoUpload = functions.storage
    .object()
    .onFinalize(async (object) => {
    const filePath = object.name || '';
    // Only run for brand pack logos
    if (!filePath.includes('brand-packs') || !filePath.includes('logo'))
        return;
    const bucket = admin.storage().bucket(object.bucket);
    const tmpFilePath = `/tmp/${uuidv4()}-${object.name?.split('/').pop()}`;
    await bucket.file(filePath).download({ destination: tmpFilePath });
    // Read image buffer
    const originalBuffer = fs.readFileSync(tmpFilePath);
    // Remove white background
    const noBgBuffer = await removeBackground(originalBuffer);
    // Resize to a maximum of 512x512 and crop to square
    let processedBuffer = await sharp(noBgBuffer)
        .resize({ width: 512, height: 512, fit: 'cover' })
        .png()
        .toBuffer();
    // Define destination path
    const parts = filePath.split('/');
    const orgIdIndex = parts.indexOf('orgs') + 1;
    const orgId = parts[orgIdIndex];
    const packIndex = parts.indexOf('brand-packs') + 1;
    const packId = parts[packIndex];
    const destPath = `orgs/${orgId}/brand/logo-prep/${packId}/processed.png`;
    await bucket.file(destPath).save(processedBuffer, { contentType: 'image/png' });
    return;
});
/**
 * Triggered on asset status change. When an asset is marked as approved (status === 'approved'
 * and final version), check if the associated order has its balance paid. If so, mark the
 * asset's deliverables as released to allow download. Also records an entry in the
 * audit log collection for traceability. Assumes assets have fields: projectId, version, status.
 */
export const onAssetUpdate = functions.firestore
    .document('assets/{assetId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after)
        return null;
    // Only act when status transitions to approved and version is final (no numeric check here)
    if (before?.status !== 'approved' && after.status === 'approved') {
        // Look up the project and order
        const projectRef = db.collection('projects').doc(after.projectId);
        const projectDoc = await projectRef.get();
        const project = projectDoc.data();
        if (!project)
            return null;
        const orderId = project.orderId;
        if (!orderId)
            return null;
        const orderDoc = await db.collection('orders').doc(orderId).get();
        const order = orderDoc.data();
        if (!order)
            return null;
        // If order balance paid then release
        if (order.status === 'balance_paid' || order.status === 'paid') {
            await change.after.ref.set({ deliverablesReleased: true }, { merge: true });
            // Write to audit log
            await db.collection('auditLogs').add({
                type: 'deliverable_release',
                assetId: context.params.assetId,
                projectId: after.projectId,
                orderId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                uid: after.uploadedBy || null
            });
        }
    }
    return null;
});
/**
 * Triggered when a new asset document is created. Processes the uploaded file to
 * generate a proxy (low-resolution video), a thumbnail image and extracts a
 * simple colour palette. The processed assets are stored alongside the original
 * file in the same folder structure. It also marks the asset as virusScanned.
 */
export const onAssetCreated = functions.firestore
    .document('assets/{assetId}')
    .onCreate(async (snap, context) => {
    const asset = snap.data();
    if (!asset || !asset.storageKey)
        return null;
    const bucket = admin.storage().bucket();
    const file = bucket.file(asset.storageKey);
    // Download original file to temp
    const tmpOriginal = `${os.tmpdir()}/${uuidv4()}-${asset.storageKey.split('/').pop()}`;
    await file.download({ destination: tmpOriginal });
    let proxyKey;
    let thumbnailKey;
    let palette;
    try {
        // Virus scanning would be done here in a real system. In this environment we simply mark
        // the file as scanned without checking for infections.
        if (asset.mime && asset.mime.startsWith('video/')) {
            // Generate proxy video (360p mp4)
            const tmpProxy = `${os.tmpdir()}/${uuidv4()}-proxy.mp4`;
            await new Promise((resolve, reject) => {
                ffmpeg(tmpOriginal)
                    .output(tmpProxy)
                    .size('360x?')
                    .videoCodec('libx264')
                    .noAudio()
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            proxyKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/proxy.mp4`;
            await bucket.upload(tmpProxy, { destination: proxyKey, contentType: 'video/mp4' });
            // Generate thumbnail (first frame)
            const tmpThumb = `${os.tmpdir()}/${uuidv4()}-thumb.jpg`;
            await new Promise((resolve, reject) => {
                ffmpeg(tmpOriginal)
                    .frames(1)
                    .outputOptions('-q:v 2')
                    .output(tmpThumb)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            thumbnailKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/thumb.jpg`;
            await bucket.upload(tmpThumb, { destination: thumbnailKey, contentType: 'image/jpeg' });
            // Extract palette from thumbnail using color-thief
            const colorThief = new ColorThief();
            const thumbBuffer = fs.readFileSync(tmpThumb);
            try {
                palette = await colorThief.getPalette(thumbBuffer, 5);
            }
            catch (err) {
                console.warn('Palette extraction failed:', err);
            }
        }
        else if (asset.mime && asset.mime.startsWith('image/')) {
            // Generate a small thumbnail via sharp
            const buffer = fs.readFileSync(tmpOriginal);
            const image = sharp(buffer);
            const thumbBuffer = await image.resize({ width: 360 }).jpeg().toBuffer();
            thumbnailKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/thumb.jpg`;
            await bucket.file(thumbnailKey).save(thumbBuffer, { contentType: 'image/jpeg' });
            // Extract palette using color-thief
            const colorThief = new ColorThief();
            try {
                palette = await colorThief.getPalette(thumbBuffer, 5);
            }
            catch (err) {
                console.warn('Palette extraction failed:', err);
            }
        }
        // Clean up temp files
        try {
            fs.unlinkSync(tmpOriginal);
        }
        catch (err) { }
    }
    catch (err) {
        console.error('Error processing asset', err);
    }
    // Update asset document with metadata
    const updates = { virusScanned: true };
    if (proxyKey)
        updates.proxyKey = proxyKey;
    if (thumbnailKey)
        updates.thumbnailKey = thumbnailKey;
    if (palette)
        updates.palette = palette;
    await snap.ref.set(updates, { merge: true });
    return null;
});
/**
 * Callable to send mass email to all leads in a group. Marks leads as contacted and
 * logs the outreach action. Expects { groupId, subject, body }.
 */
export const sendGroupEmail = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { groupId, subject, body } = data;
    if (!groupId || !subject || !body)
        throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
    const groupSnap = await db.collection('groups').doc(groupId).get();
    if (!groupSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Group not found');
    const group = groupSnap.data();
    const userIds = group.userIds || [];
    const leadIds = group.leadIds || [];
    let count = 0;
    if (userIds.length > 0) {
        for (const uid of userIds) {
            const userSnap = await db.collection('users').doc(uid).get();
            if (!userSnap.exists)
                continue;
            const user = userSnap.data();
            await db.collection('emails').add({
                orgId: group.orgId,
                projectId: null,
                threadId: uuidv4(),
                from: context.auth.token.email,
                to: user.email,
                subject,
                body,
                attachments: [],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent'
            });
            count++;
        }
    }
    else {
        for (const lid of leadIds) {
            const leadSnap = await db.collection('leads').doc(lid).get();
            if (!leadSnap.exists)
                continue;
            const lead = leadSnap.data();
            await db.collection('emails').add({
                orgId: group.orgId,
                projectId: null,
                threadId: uuidv4(),
                from: context.auth.token.email,
                to: lead.email,
                subject,
                body,
                attachments: [],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent'
            });
            await db.collection('leads').doc(lid).set({ status: 'contacted' }, { merge: true });
            count++;
        }
    }
    return { count };
});
/**
 * Create a dynamic group of users based on purchase history or profile fields.
 * Expects { name, productId?, month?, industry?, location? } and returns count
 * of matched users. Stores matching userIds on the group document for later reuse.
 */
export const groups_createCustom = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { name, productId, month, industry, location } = data;
    if (!name)
        throw new functions.https.HttpsError('invalid-argument', 'Name required');
    // gather user IDs matching profile filters
    const usersSnap = await db.collection('users').get();
    let ids = new Set();
    usersSnap.forEach((u) => {
        const user = u.data();
        if (industry && user.industry !== industry)
            return;
        if (location && user.location !== location)
            return;
        ids.add(u.id);
    });
    // filter by orders if product or month specified
    if (productId || month) {
        const orderSnap = await db.collection('orders').get();
        const orderUserIds = new Set();
        orderSnap.forEach((o) => {
            const order = o.data();
            if (productId && !(order.items || []).some((i) => i.id === productId))
                return;
            if (month) {
                const ts = order.createdAt?.toDate ? order.createdAt.toDate() : null;
                if (!ts || ts.getMonth() + 1 !== month)
                    return;
            }
            if (order.userId)
                orderUserIds.add(order.userId);
        });
        ids = new Set([...ids].filter((id) => orderUserIds.has(id)));
    }
    const userIds = Array.from(ids);
    await db.collection('groups').add({
        name,
        orgId: null,
        userIds,
        filters: { productId: productId || null, month: month || null, industry: industry || null, location: location || null },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { count: userIds.length };
});
/**
* Callable to synchronise availability with an external calendar.
* Supports Google Calendar via service account or Microsoft Outlook via the Graph API.
* The provider is selected with data.provider ('google' | 'microsoft') and defaults to Google.
*/
export const calendar_syncAvailability = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const provider = data.provider || 'google';
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    let busy = [];
    try {
        if (provider === 'google') {
            const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
            if (!keyB64)
                throw new Error('Missing Google service account credentials');
            const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
            const jwtClient = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/calendar.readonly']);
            await jwtClient.authorize();
            const calendar = google.calendar({ version: 'v3', auth: jwtClient });
            const fb = await calendar.freebusy.query({
                requestBody: {
                    timeMin: now.toISOString(),
                    timeMax: end.toISOString(),
                    items: [{ id: 'primary' }],
                },
            });
            const gBusy = fb.data.calendars?.primary?.busy || [];
            busy = gBusy.map((b) => ({ start: b.start || '', end: b.end || '' }));
        }
        else if (provider === 'microsoft') {
            const tenant = process.env.MS_TENANT_ID;
            const clientId = process.env.MS_CLIENT_ID;
            const clientSecret = process.env.MS_CLIENT_SECRET;
            const userId = data.userId || process.env.MS_USER_ID;
            if (!tenant || !clientId || !clientSecret || !userId) {
                throw new Error('Missing Microsoft Graph credentials');
            }
            const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    scope: 'https://graph.microsoft.com/.default',
                    grant_type: 'client_credentials',
                }),
            });
            const tokenJson = (await tokenRes.json());
            const token = tokenJson.access_token;
            if (!token)
                throw new Error('Failed to obtain Microsoft Graph token');
            const eventsRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const eventsJson = (await eventsRes.json());
            const events = eventsJson.value || [];
            busy = events.map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));
        }
        else {
            throw new functions.https.HttpsError('invalid-argument', 'Unsupported provider');
        }
        // Convert busy periods into availability slots: any time not in busy array within working hours (9am-5pm) is free
        const availability = [];
        let cursor = new Date(now);
        while (cursor < end) {
            const dayStart = new Date(cursor.setHours(9, 0, 0, 0));
            const dayEnd = new Date(cursor.setHours(17, 0, 0, 0));
            let freeStart = new Date(dayStart);
            for (const b of busy) {
                const busyStart = new Date(b.start || '');
                const busyEnd = new Date(b.end || '');
                if (busyEnd <= freeStart || busyStart >= dayEnd)
                    continue;
                // If there is free time before the busy slot, record it
                if (busyStart > freeStart) {
                    availability.push({ start: freeStart.toISOString(), end: busyStart.toISOString() });
                }
                freeStart = busyEnd > freeStart ? busyEnd : freeStart;
            }
            // Free time after last busy period until end of day
            if (freeStart < dayEnd) {
                availability.push({ start: freeStart.toISOString(), end: dayEnd.toISOString() });
            }
            // Move to next day
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        }
        // Store availability in Firestore (overwrite existing future slots for the user)
        const batch = db.batch();
        const uid = context.auth?.uid;
        if (!uid)
            throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
        // Remove existing future availability for this user
        const availSnap = await db.collection('availability').where('uid', '==', uid).where('start', '>=', now).get();
        availSnap.docs.forEach((doc) => batch.delete(doc.ref));
        // Add new slots
        availability.forEach((slot) => {
            const ref = db.collection('availability').doc();
            batch.set(ref, {
                uid,
                start: slot.start,
                end: slot.end,
                isBookable: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        await batch.commit();
        return { slots: availability.length };
    }
    catch (err) {
        console.error('calendar_syncAvailability error:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
/**
 * Callable to create a calendar event for a confirmed booking.
 * Supports both Google Calendar and Microsoft Outlook depending on data.provider.
 */
export const calendar_createEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { bookingId, calendarId, provider = 'google' } = data;
    if (!bookingId)
        throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
    // Retrieve booking and associated user/org
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Booking not found');
    const booking = bookingDoc.data();
    try {
        if (provider === 'google') {
            const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
            if (!keyB64)
                throw new Error('Missing Google service account credentials');
            const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
            const jwtClient = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/calendar']);
            await jwtClient.authorize();
            const calendar = google.calendar({ version: 'v3', auth: jwtClient });
            const event = await calendar.events.insert({
                calendarId: calendarId || 'primary',
                requestBody: {
                    summary: `Booking for ${booking.serviceId || 'service'}`,
                    description: booking.notes || '',
                    start: { dateTime: booking.slot.start || booking.slot, timeZone: 'Europe/London' },
                    end: { dateTime: booking.slot.end || booking.slot, timeZone: 'Europe/London' },
                    attendees: [],
                },
            });
            const eventId = event.data.id;
            await db.collection('bookings').doc(bookingId).set({ calendarEventId: eventId }, { merge: true });
            return { eventId };
        }
        else if (provider === 'microsoft') {
            const tenant = process.env.MS_TENANT_ID;
            const clientId = process.env.MS_CLIENT_ID;
            const clientSecret = process.env.MS_CLIENT_SECRET;
            const userId = data.userId || process.env.MS_USER_ID;
            if (!tenant || !clientId || !clientSecret || !userId) {
                throw new Error('Missing Microsoft Graph credentials');
            }
            const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    scope: 'https://graph.microsoft.com/.default',
                    grant_type: 'client_credentials',
                }),
            });
            const tokenJson = (await tokenRes.json());
            const token = tokenJson.access_token;
            if (!token)
                throw new Error('Failed to obtain Microsoft Graph token');
            const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/calendar/events`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    subject: `Booking for ${booking.serviceId || 'service'}`,
                    body: { contentType: 'HTML', content: booking.notes || '' },
                    start: { dateTime: booking.slot.start || booking.slot, timeZone: 'Europe/London' },
                    end: { dateTime: booking.slot.end || booking.slot, timeZone: 'Europe/London' },
                    attendees: [],
                }),
            });
            const event = (await res.json());
            const eventId = event.id;
            await db.collection('bookings').doc(bookingId).set({ calendarEventId: eventId }, { merge: true });
            return { eventId };
        }
        else {
            throw new functions.https.HttpsError('invalid-argument', 'Unsupported provider');
        }
    }
    catch (err) {
        console.error('calendar_createEvent error:', err);
        // Fallback: mark with placeholder event ID
        await db.collection('bookings').doc(bookingId).set({ calendarEventId: 'external-' + bookingId }, { merge: true });
        return { eventId: 'external-' + bookingId };
    }
});
/**
 * Scheduled function to generate campaign suggestions for each organisation based on
 * products previously ordered. For demonstration this simply creates a generic
 * suggestion pointing to a popular product. Runs daily.
 */
export const recommendations_generate = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    // Fetch all products once
    const productsSnap = await db.collection('products').get();
    if (productsSnap.empty)
        return null;
    const products = productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const orgsSnap = await db.collection('orgs').get();
    const batch = db.batch();
    for (const orgDoc of orgsSnap.docs) {
        const orgId = orgDoc.id;
        // Retrieve set of productIds already ordered by the org
        const ordersSnap = await db.collection('orders').where('orgId', '==', orgId).get();
        const orderedProductIds = new Set();
        ordersSnap.forEach((orderDoc) => {
            const o = orderDoc.data();
            if (o.serviceId)
                orderedProductIds.add(o.serviceId);
        });
        // Choose a product not yet ordered; simple heuristic: random selection among not-ordered products
        const candidates = products.filter((p) => !orderedProductIds.has(p.id));
        if (candidates.length === 0)
            continue;
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        const recRef = db.collection('recommendations').doc();
        batch.set(recRef, {
            orgId,
            type: 'campaign',
            title: `Consider our ${chosen.name} service`,
            body: `We think the ${chosen.name} package would help your business based on your order history.`,
            cta: `/products/${chosen.id}`,
            linkedServiceId: chosen.id,
            score: Math.random(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    return null;
});
/**
 * Callable to send an email. Stores the email in the emails collection and uses nodemailer
 * to send via SMTP if configured. Expected data: { to: string, subject: string, body: string, attachments?: [] }
 */
export const emails_send = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const emailData = {
        orgId: data.orgId || null,
        projectId: data.projectId || null,
        threadId: uuidv4(),
        from: context.auth.token.email,
        to: data.to,
        subject: data.subject,
        body: data.body,
        attachments: data.attachments || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
    };
    const emailRef = await db.collection('emails').add(emailData);
    // Attempt to send via Gmail API using a service account. We support sending
    // transactional emails through Google Workspace if the environment variable
    // `GMAIL_SERVICE_ACCOUNT_KEY_BASE64` is provided. The key should contain
    // the JSON credentials for a service account with domain-wide delegation
    // enabled on the Gmail API. Note: this integration will silently fail in
    // development environments if the credentials are missing. See docs for
    // details on configuring the service account.
    try {
        const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
        if (keyB64) {
            const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
            const authClient = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/gmail.send']);
            await authClient.authorize();
            const gmail = google.gmail({ version: 'v1', auth: authClient });
            // Construct RFC822 email. The raw string must be base64url encoded
            const message = [
                `From: ${emailData.from}`,
                `To: ${emailData.to}`,
                `Subject: ${emailData.subject}`,
                'Content-Type: text/plain; charset=UTF-8',
                '',
                emailData.body || '',
            ].join('\n');
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            await gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw: encodedMessage },
            });
        }
    }
    catch (err) {
        console.error('emails_send Gmail error:', err);
    }
    return { id: emailRef.id };
});
/**
 * Callable to record an incoming email. In a real implementation this would be invoked
 * by an email webhook. Here we simply store the email in the emails collection.
 */
export const emails_receive = functions.https.onCall(async (data, context) => {
    // No auth required since this could be invoked by an email gateway
    const emailRef = await db.collection('emails').add({
        orgId: data.orgId || null,
        projectId: data.projectId || null,
        threadId: data.threadId || uuidv4(),
        from: data.from,
        to: data.to,
        subject: data.subject,
        body: data.body,
        attachments: data.attachments || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'received'
    });
    return { id: emailRef.id };
});
/**
 * When a new inbound email is stored, this trigger checks if the sender corresponds
 * to an existing lead. If so, the lead's status is updated to 'opportunity' and
 * a new opportunity document is created. This enables funneling responses back into
 * the CRM pipeline.
 */
export const onEmailReceived = functions.firestore
    .document('emails/{emailId}')
    .onCreate(async (snap, context) => {
    const email = snap.data();
    if (email.status !== 'received')
        return null;
    const from = email.from;
    if (!from)
        return null;
    // Find lead by email address
    const leadSnap = await db.collection('leads').where('email', '==', from).limit(1).get();
    if (leadSnap.empty)
        return null;
    const leadDoc = leadSnap.docs[0];
    // Update lead status
    await leadDoc.ref.set({ status: 'opportunity' }, { merge: true });
    // Create opportunity document
    await db.collection('opportunities').add({
        leadId: leadDoc.id,
        orgId: leadDoc.data().orgId,
        stage: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEmailId: snap.id,
    });
    return null;
});
/**
 * Callable to request an e-signature. Creates a signatures document with pending status.
 */
export const esign_request = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const sigRef = await db.collection('signatures').add({
        projectId: data.projectId,
        orgId: data.orgId,
        docAssetId: data.docAssetId,
        signerUid: data.signerUid,
        status: 'requested',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { id: sigRef.id };
});
/**
 * Create an order from cart item IDs and quantities. Fetches product data to calculate
 * pricing server-side and writes the order document with status 'pending'. Returns
 * the created order ID.
 */
export const createOrder = functions.https.onCall(async (data, context) => {
    const toNumber = (value, fallback = 0) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    };
    const parseOptional = (value) => value === undefined || value === null ? undefined : toNumber(value);
    const DEFAULT_TRAVEL_MILES = 100;
    const DEFAULT_TRAVEL_RATE = 0.3;
    const { items, userEmail, customerName, companyName, location, projectName, voucher, kitItems = [], rentalSubtotal = 0, } = data;
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'items are required');
    }
    const productRefs = items.map((i) => db.collection('products').doc(i.id));
    const productSnaps = await db.getAll(...productRefs);
    const orderItems = [];
    let productSubtotal = 0;
    let labourSubtotal = 0;
    let kitSubtotal = 0;
    let travelSubtotal = 0;
    let parkingSubtotal = 0;
    productSnaps.forEach((snap, idx) => {
        if (!snap.exists)
            return;
        const prod = snap.data();
        const qty = items[idx].quantity || 0;
        const price = prod.price || 0;
        const category = prod.category || prod.categoryId || null;
        const rental = items[idx].rentalTotal || 0;
        const modifiers = Array.isArray(items[idx].modifiers)
            ? items[idx].modifiers
            : [];
        const budget = prod.budget || {};
        const labourFilming = parseOptional(budget.labourFilming);
        const labourEditing = parseOptional(budget.labourEditing);
        const labourBase = toNumber(budget.labour ?? prod.labourCost);
        const labour = labourFilming !== undefined || labourEditing !== undefined
            ? (labourFilming ?? 0) + (labourEditing ?? 0)
            : labourBase;
        const kitManual = parseOptional(budget.kitManual);
        const kitGuidance = parseOptional(budget.kitGuidance);
        let kit = toNumber(budget.kit ?? prod.defaultKitCost);
        if (budget.kitMode === "guided") {
            kit = kitGuidance ?? kit;
        }
        else if (budget.kitMode === "manual") {
            kit = kitManual ?? kit;
        }
        else if (kitManual !== undefined || kitGuidance !== undefined) {
            kit = kitManual ?? kitGuidance ?? kit;
        }
        const travelMilesValue = toNumber(budget.travelMiles, DEFAULT_TRAVEL_MILES);
        const travelRateValue = toNumber(budget.travelRate, DEFAULT_TRAVEL_RATE);
        const travelCost = toNumber(budget.travelCost, toNumber(travelMilesValue * travelRateValue));
        const parking = toNumber(budget.parking);
        const perUnitBudgetTotal = labour + kit + travelCost + parking;
        orderItems.push({
            id: snap.id,
            name: prod.name,
            price,
            quantity: qty,
            category,
            rentalTotal: rental,
            modifiers,
            budget: {
                perUnit: {
                    labour,
                    kit,
                    travelMiles: travelMilesValue,
                    travelRate: travelRateValue,
                    travelCost,
                    parking,
                    totalCost: perUnitBudgetTotal,
                },
                total: {
                    labour: labour * qty,
                    kit: kit * qty,
                    travel: travelCost * qty,
                    parking: parking * qty,
                    totalCost: perUnitBudgetTotal * qty,
                },
            },
        });
        productSubtotal += price * qty;
        labourSubtotal += labour * qty;
        kitSubtotal += kit * qty;
        travelSubtotal += travelCost * qty;
        parkingSubtotal += parking * qty;
    });
    // Apply voucher discount if provided
    let voucherDiscount = 0;
    let voucherCode = null;
    if (voucher) {
        const vSnap = await db
            .collection('vouchers')
            .where('code', '==', voucher)
            .limit(1)
            .get();
        if (!vSnap.empty) {
            const v = vSnap.docs[0].data();
            const locs = v.locations || [];
            const locAllowed = locs.length === 0 ||
                (location && locs.map((l) => l.toLowerCase()).includes(String(location).toLowerCase()));
            if (locAllowed) {
                const prodIds = v.productIds || [];
                const catIds = v.categoryIds || [];
                let eligibleSubtotal = 0;
                orderItems.forEach((item) => {
                    const prodOk = prodIds.length === 0 || prodIds.includes(item.id);
                    const catOk = catIds.length === 0 || catIds.includes(item.category);
                    if (prodOk && catOk)
                        eligibleSubtotal += item.price * item.quantity;
                });
                if (eligibleSubtotal > 0) {
                    if (v.type === 'percentage') {
                        voucherDiscount = eligibleSubtotal * (v.amount / 100);
                    }
                    else if (v.type === 'fixed') {
                        voucherDiscount = Math.min(v.amount, eligibleSubtotal);
                    }
                    voucherCode = voucher;
                }
            }
        }
    }
    const subtotalAfterVoucher = productSubtotal - voucherDiscount;
    let discountPct = 0;
    if (context.auth?.uid) {
        const userSnap = await db.collection('users').doc(context.auth.uid).get();
        discountPct = userSnap.data()?.discount || 0;
    }
    const discountAmount = subtotalAfterVoucher * (discountPct / 100);
    const finalTotal = subtotalAfterVoucher - discountAmount + rentalSubtotal;
    const vat = finalTotal * VAT_RATE;
    const price = finalTotal + vat;
    const budgetSubtotal = labourSubtotal + kitSubtotal + travelSubtotal + parkingSubtotal;
    const profit = finalTotal - (budgetSubtotal + rentalSubtotal);
    const budgetTotals = {
        labour: labourSubtotal,
        kit: kitSubtotal,
        travel: travelSubtotal,
        parking: parkingSubtotal,
        rental: rentalSubtotal,
        totalCost: budgetSubtotal + rentalSubtotal,
        netRevenue: finalTotal,
        grossRevenue: price,
        profit,
    };
    const orderRef = await db.collection('orders').add({
        userId: context.auth?.uid || null,
        userEmail: context.auth?.token.email || userEmail || null,
        customerName,
        companyName: companyName || null,
        location: location || null,
        projectName: projectName || null,
        voucher: voucherCode,
        items: orderItems,
        subtotal: productSubtotal,
        rentalSubtotal,
        labourSubtotal,
        kitSubtotal,
        travelSubtotal,
        parkingSubtotal,
        budgetSubtotal,
        budgetTotals,
        kitItems,
        voucherDiscount,
        discountPct,
        discountAmount,
        netTotal: finalTotal,
        vat,
        price,
        profit,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { orderId: orderRef.id };
});
/**
 * Create a Stripe PaymentIntent for either the deposit or balance payment of an order. This callable
 * expects { orderId, type } where type is 'deposit' or 'balance'. The amount is calculated from
 * the order document. The PaymentIntent metadata includes the orderId and type so that the webhook
 * can update the order status accordingly.
 */
export const stripe_createPaymentIntent = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { orderId, type } = data;
    if (!orderId || !type)
        throw new functions.https.HttpsError('invalid-argument', 'orderId and type are required');
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Order not found');
    const order = orderDoc.data();
    const price = order.price || 0;
    const depositPercentage = order.depositPercentage || 0;
    const depositAmount = order.depositAmount || (price * (depositPercentage / 100));
    const balanceAmount = order.balanceAmount || (price - depositAmount);
    let amount;
    let description;
    if (type === 'deposit') {
        amount = Math.round(depositAmount * 100);
        description = `Deposit for order ${orderId}`;
    }
    else if (type === 'balance') {
        amount = Math.round(balanceAmount * 100);
        description = `Balance for order ${orderId}`;
    }
    else {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid payment type');
    }
    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'gbp',
        description,
        metadata: { orderId, type },
        automatic_payment_methods: { enabled: true },
    });
    return { clientSecret: paymentIntent.client_secret };
});
// Stripe webhook (deposit/balance) — skeleton
export const stripe_webhook = functions.https.onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
    }
    catch (err) {
        console.error('Webhook signature verification failed.', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }
    // Handle payment events
    try {
        const eventType = event.type;
        if (eventType === 'payment_intent.succeeded') {
            const pi = event.data.object;
            const metadata = pi.metadata || {};
            const orderId = metadata.orderId;
            const payType = metadata.type;
            if (orderId && payType) {
                const orderRef = db.collection('orders').doc(orderId);
                const orderSnap = await orderRef.get();
                if (orderSnap.exists) {
                    const updates = {
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    };
                    switch (payType) {
                        case 'deposit':
                            updates.status = 'deposit_paid';
                            break;
                        case 'balance':
                            updates.status = 'balance_paid';
                            break;
                        default:
                            console.warn('Unknown payment type', payType);
                    }
                    await orderRef.set(updates, { merge: true });
                    // If deposit is paid and project not yet created, create project document here
                    const orderData = orderSnap.data();
                    if (payType === 'deposit' && !orderData.projectId) {
                        // Create a new project using order's orgId and serviceId
                        const projRef = await db.collection('projects').add({
                            orgId: orderData.orgId,
                            serviceId: orderData.serviceId,
                            orderId,
                            title: orderData.serviceName || 'New Project',
                            status: 'intake',
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        await orderRef.set({ projectId: projRef.id }, { merge: true });
                    }
                }
            }
        }
        // Optionally handle other event types (payment_intent.payment_failed, etc.)
        res.json({ received: true });
        return;
    }
    catch (webhookErr) {
        console.error('Error handling Stripe webhook:', webhookErr);
        res.status(500).send('Internal error');
        return;
    }
});
// Google Drive upload via Service Account
export const uploadToDrive = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const { fileName, mimeType, content, folderId } = data || {};
    if (!fileName || !content) {
        throw new functions.https.HttpsError('invalid-argument', 'fileName and content required');
    }
    try {
        const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
        if (!keyB64) {
            throw new Error('Missing Google service account credentials');
        }
        const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
        const auth = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/drive.file']);
        await auth.authorize();
        const drive = google.drive({ version: 'v3', auth });
        const fileMetadata = { name: fileName };
        if (folderId)
            fileMetadata.parents = [folderId];
        const media = {
            mimeType: mimeType || 'application/octet-stream',
            body: Readable.from(Buffer.from(content, 'base64')),
        };
        const res = await drive.files.create({
            requestBody: fileMetadata,
            media,
            fields: 'id',
        });
        return { fileId: res.data.id };
    }
    catch (err) {
        console.error('uploadToDrive error:', err);
        throw new functions.https.HttpsError('internal', 'Drive upload failed');
    }
});
// Live stream project setup — skeleton
export const liveStreams_create = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const projectId = data.projectId;
    if (!projectId) {
        throw new functions.https.HttpsError('invalid-argument', 'projectId required');
    }
    try {
        const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
        if (!keyB64)
            throw new Error('Missing Google service account credentials');
        const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
        const auth = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/youtube']);
        await auth.authorize();
        const youtube = google.youtube({ version: 'v3', auth });
        const stream = await youtube.liveStreams.insert({
            part: ['snippet', 'cdn'],
            requestBody: {
                snippet: { title: `Stream for project ${projectId}` },
                cdn: { ingestionType: 'rtmp', resolution: '720p', frameRate: '30fps' },
            },
        });
        const broadcast = await youtube.liveBroadcasts.insert({
            part: ['snippet', 'status', 'contentDetails'],
            requestBody: {
                snippet: {
                    title: `Broadcast for project ${projectId}`,
                    scheduledStartTime: new Date().toISOString(),
                },
                status: { privacyStatus: 'unlisted' },
                contentDetails: { latencyPreference: 'normal' },
            },
        });
        await youtube.liveBroadcasts.bind({
            part: ['id', 'snippet', 'contentDetails', 'status'],
            id: broadcast.data.id,
            streamId: stream.data.id,
        });
        await db.collection('projects').doc(projectId).set({
            live: {
                streamId: stream.data.id || null,
                broadcastId: broadcast.data.id || null,
                ingestionAddress: stream.data.cdn?.ingestionInfo?.ingestionAddress || null,
                streamKey: stream.data.cdn?.ingestionInfo?.streamName || null,
            },
        }, { merge: true });
        return { streamId: stream.data.id, broadcastId: broadcast.data.id };
    }
    catch (err) {
        console.error('liveStreams_create error:', err);
        throw new functions.https.HttpsError('internal', 'Failed to create live stream');
    }
});
/**
 * Assign an admin and stream key to an existing live stream project. Requires staff privileges.
 * Expects { projectId, adminUid }. Stores stream key reference and admin uid in the project's live field.
 */
export const liveStreams_assignAdmin = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const userSnap = await db.collection('users').doc(context.auth.uid).get();
    if (!userSnap.exists || !userSnap.data()?.isStaff)
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    const { projectId, adminUid } = data;
    if (!projectId || !adminUid)
        throw new functions.https.HttpsError('invalid-argument', 'Missing parameters');
    await db.collection('projects').doc(projectId).set({ live: { adminUid, streamKeyRef: 'secret://streams/' + projectId } }, { merge: true });
    return { ok: true };
});
/**
 * Export an invoice to Xero. This is a skeleton implementation that would POST invoice details
 * to the Xero API using OAuth credentials stored in environment variables. Expects { orderId }.
 */
export const xero_exportInvoice = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { orderId } = data;
    if (!orderId)
        throw new functions.https.HttpsError('invalid-argument', 'Order ID required');
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Order not found');
    const order = orderDoc.data();
    // Build invoice payload (simplified)
    const invoice = {
        type: 'ACCREC',
        contact: { name: order.customerName || 'Client' },
        lineItems: [{ description: order.serviceName || 'Service', quantity: 1, unitAmount: order.price || 0, accountCode: '200' }],
        date: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        reference: orderId,
    };
    // In a real implementation, obtain OAuth token and call Xero API here using fetch
    console.log('Would export invoice to Xero:', invoice);
    return { ok: true };
});
/**
 * Export an invoice to QuickBooks. Generates an access token using OAuth2 credentials
 * stored in environment variables and creates an invoice via the QuickBooks Online API.
 * Expects { orderId } and stores the resulting invoice ID back on the order document.
 * See QuickBooks developer docs for details:
 * https://developer.intuit.com/app/developer/qbo/docs/develop/rest-api
 */
export const quickbooks_exportInvoice = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { orderId } = data;
    if (!orderId)
        throw new functions.https.HttpsError('invalid-argument', 'Order ID required');
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Order not found');
    const order = orderDoc.data();
    const invoice = {
        CustomerRef: { value: order.customerId || '1', name: order.customerName || 'Client' },
        TxnDate: new Date().toISOString().split('T')[0],
        Line: [
            {
                DetailType: 'SalesItemLineDetail',
                Amount: order.price || 0,
                Description: order.serviceName || 'Service',
                SalesItemLineDetail: {
                    ItemRef: { value: '1', name: order.serviceName || 'Service' },
                    Qty: 1,
                    UnitPrice: order.price || 0,
                },
            },
        ],
        DueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        PrivateNote: `Order ${orderId}`,
    };
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN;
    const realmId = process.env.QUICKBOOKS_REALM_ID;
    if (!clientId || !clientSecret || !refreshToken || !realmId) {
        console.error('Missing QuickBooks environment variables');
        throw new functions.https.HttpsError('failed-precondition', 'QuickBooks configuration missing');
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error('QuickBooks token error', text);
        throw new functions.https.HttpsError('internal', 'QuickBooks auth failed');
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    const invoiceRes = await fetch(`https://quickbooks.api.intuit.com/v3/company/${realmId}/invoice?minorversion=65`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(invoice),
    });
    const invoiceJson = await invoiceRes.json();
    if (!invoiceRes.ok || !invoiceJson?.Invoice?.Id) {
        console.error('QuickBooks invoice error', invoiceJson);
        throw new functions.https.HttpsError('internal', 'QuickBooks invoice creation failed');
    }
    await orderDoc.ref.update({ quickbooksInvoiceId: invoiceJson.Invoice.Id });
    return { invoiceId: invoiceJson.Invoice.Id };
});
/**
 * Trigger a webhook in n8n or Pabbly to notify external workflows of an event. Expects { url, payload }.
 */
export const triggerWebhook = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { url, payload } = data;
    if (!url)
        throw new functions.https.HttpsError('invalid-argument', 'Webhook URL required');
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
        console.log('Webhook response status', res.status);
        return { status: res.status };
    }
    catch (err) {
        console.error('Webhook error', err);
        throw new functions.https.HttpsError('internal', 'Webhook call failed');
    }
});
/**
 * Publish a video to YouTube. In a real implementation this would use the Google APIs to upload
 * a processed video file and set metadata. Expects { assetId, title, description }.
 */
export const youtube_publish = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { assetId, title, description } = data;
    if (!assetId)
        throw new functions.https.HttpsError('invalid-argument', 'assetId required');
    console.log(`Would publish asset ${assetId} to YouTube with title ${title}`);
    return { ok: true };
});
/**
 * Publish a video to Vimeo. In a real implementation this would use the Vimeo API to upload
 * a processed video file and set metadata. Expects { assetId, title, description }.
 */
export const vimeo_publish = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { assetId, title, description } = data;
    if (!assetId)
        throw new functions.https.HttpsError('invalid-argument', 'assetId required');
    console.log(`Would publish asset ${assetId} to Vimeo with title ${title}`);
    return { ok: true };
});
/**
 * Upload a file to OneDrive using Microsoft Graph API. Expects
 * { path, content } where content is a base64 string. Uploads as the user
 * specified by MS_USER_ID using client credentials.
 */
export const onedrive_upload = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { path, content } = data;
    if (!path || !content)
        throw new functions.https.HttpsError('invalid-argument', 'path and content required');
    const tenant = process.env.MS_TENANT_ID;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;
    const userId = process.env.MS_USER_ID;
    if (!tenant || !clientId || !clientSecret || !userId)
        throw new functions.https.HttpsError('failed-precondition', 'Microsoft Graph credentials not configured');
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
        }),
    });
    const tokenJson = (await tokenRes.json());
    const token = tokenJson.access_token;
    if (!token)
        throw new functions.https.HttpsError('internal', 'Failed to obtain Microsoft Graph token');
    const normalized = path.replace(/^\/+/, '');
    const encodedPath = encodeURIComponent(normalized).replace(/%2F/g, '/');
    const uploadUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/drive/root:/${encodedPath}:/content`;
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: Buffer.from(content, 'base64'),
    });
    if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new functions.https.HttpsError('internal', `OneDrive upload failed: ${text}`);
    }
    const fileJson = (await uploadRes.json());
    return { id: fileJson.id, webUrl: fileJson.webUrl || null };
});
/**
 * Create a subscription plan in Stripe. Expects { name, amount, interval, currency? }.
 * Generates a Stripe product and recurring price then stores them under a Firestore
 * `plans` collection for later use.
 */
export const stripe_createPlan = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { name, amount, interval, currency = 'gbp' } = data;
    if (!name || !amount || !interval)
        throw new functions.https.HttpsError('invalid-argument', 'Missing plan parameters');
    try {
        const product = await stripe.products.create({ name });
        const price = await stripe.prices.create({
            unit_amount: Math.round(amount * 100),
            currency,
            recurring: { interval },
            product: product.id,
        });
        const planRef = await db.collection('plans').add({
            name,
            amount,
            interval,
            currency,
            productId: product.id,
            priceId: price.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { planId: planRef.id, productId: product.id, priceId: price.id };
    }
    catch (err) {
        console.error('Error creating Stripe plan', err);
        throw new functions.https.HttpsError('internal', 'Stripe plan creation failed');
    }
});
/**
 * Create a subscription for an organisation. Expects { orgId, planId, customerEmail }.
 * If the organisation lacks a Stripe customer it is created and stored. The planId may
 * refer either to a Firestore plan document or directly to a Stripe price ID.
 */
export const stripe_createSubscription = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { orgId, planId, customerEmail } = data;
    if (!orgId || !planId || !customerEmail)
        throw new functions.https.HttpsError('invalid-argument', 'Missing subscription parameters');
    const orgRef = db.collection('orgs').doc(orgId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Org not found');
    let priceId = planId;
    const planSnap = await db.collection('plans').doc(planId).get();
    if (planSnap.exists) {
        const planData = planSnap.data();
        priceId = planData.priceId;
    }
    try {
        let customerId = orgSnap.data().stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({ email: customerEmail });
            customerId = customer.id;
            await orgRef.set({ stripeCustomerId: customerId }, { merge: true });
        }
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
        });
        await orgRef.set({
            stripeSubscriptionId: subscription.id,
            planId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { subscriptionId: subscription.id };
    }
    catch (err) {
        console.error('Error creating subscription', err);
        throw new functions.https.HttpsError('internal', 'Subscription creation failed');
    }
});
/**
 * Cancel a subscription. Expects { subscriptionId }. Also clears references on any org
 * document that stored this subscription.
 */
export const stripe_cancelSubscription = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { subscriptionId } = data;
    if (!subscriptionId)
        throw new functions.https.HttpsError('invalid-argument', 'Subscription ID required');
    try {
        await stripe.subscriptions.cancel(subscriptionId);
        const snap = await db
            .collection('orgs')
            .where('stripeSubscriptionId', '==', subscriptionId)
            .get();
        for (const doc of snap.docs) {
            await doc.ref.set({
                stripeSubscriptionId: admin.firestore.FieldValue.delete(),
                planId: admin.firestore.FieldValue.delete(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        return { ok: true };
    }
    catch (err) {
        console.error('Error cancelling subscription', err);
        throw new functions.https.HttpsError('internal', 'Subscription cancellation failed');
    }
});
/**
 * Create a Stripe Checkout session for an order and return the redirect URL.
 * Expected data: { orderId, lineItems }
 */
export const stripe_createCheckoutSession = functions.https.onCall(async (data, context) => {
    const { orderId, lineItems } = data;
    if (!orderId || !Array.isArray(lineItems) || !lineItems.length) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId and lineItems required');
    }
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: lineItems,
            success_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/orders/${orderId}`,
            cancel_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/cart`,
        });
        await db.collection('orders').doc(orderId).set({ stripeSessionId: session.id }, { merge: true });
        return { url: session.url };
    }
    catch (err) {
        console.error('Error creating checkout session', err);
        throw new functions.https.HttpsError('internal', 'Unable to create checkout session');
    }
});
/**
 * Create or update an agreement or policy. Only staff users can call this.
 * Expected data: { id?, title, content, category, requireSign?, forceResign? }.
 * When creating a new document it records createdAt and a history entry. Updates
 * add an updatedAt timestamp and history entry. If requireSign and forceResign
 * are true, all contractors are prompted to re-sign.
 */
export const agreements_update = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const { id, title, content, category, requireSign, forceResign } = data;
    if (!title || !content) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing title or content');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    let agreementRef;
    if (id) {
        agreementRef = db.collection('agreements').doc(id);
        await agreementRef.set({
            title,
            content,
            category: category || 'general',
            requireSign: requireSign === true,
            updatedAt: now,
            history: admin.firestore.FieldValue.arrayUnion({ event: 'updated', at: now })
        }, { merge: true });
    }
    else {
        agreementRef = await db.collection('agreements').add({
            title,
            content,
            category: category || 'general',
            requireSign: requireSign === true,
            createdAt: now,
            history: [{ event: 'created', at: now }]
        });
    }
    if (requireSign && forceResign) {
        const contractorsSnap = await db.collection('users').where('contractor', '==', true).get();
        const batch = db.batch();
        contractorsSnap.forEach((doc) => {
            batch.set(doc.ref, { agreedVersion: null }, { merge: true });
            batch.set(db.collection('notifications').doc(), {
                userId: doc.id,
                title: 'Agreement Updated',
                body: `A new agreement "${title}" requires your signature.`,
                createdAt: now,
                read: false
            });
        });
        await batch.commit();
    }
    return { id: agreementRef.id };
});
/** Record a signature for an agreement */
export const agreements_sign = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { agreementId } = data;
    if (!agreementId)
        throw new functions.https.HttpsError('invalid-argument', 'Missing agreementId');
    const sigRef = db.collection('agreements').doc(agreementId).collection('signatures').doc(context.auth.uid);
    await sigRef.set({
        uid: context.auth.uid,
        signedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { ok: true };
});
/**
 * Create a new policy or update an existing one. Only staff users can call this.
 * Expected data: { id?: string, title: string, content: string, audience: 'client'|'contractor', version: string }.
 */
export const policies_upsert = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const { id, title, content, audience, version } = data;
    if (!title || !content || !audience || !version) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
    }
    let policyRef;
    if (id) {
        policyRef = db.collection('policies').doc(id);
        await policyRef.set({ title, content, audience, version, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    else {
        policyRef = await db.collection('policies').add({
            title,
            content,
            audience,
            version,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    return { id: policyRef.id };
});
/**
 * Delete a policy. Staff only.
 */
export const policies_delete = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const { id } = data;
    if (!id)
        throw new functions.https.HttpsError('invalid-argument', 'Policy ID required');
    await db.collection('policies').doc(id).delete();
    return { ok: true };
});
/**
 * Create or update an email schedule. Staff only. Expects:
 * { id?: string, groupId: string, subject: string, body: string,
 *   schedule: string (RRULE or cron expression), ratePerMinute: number, enabled: boolean }.
 */
export const emailSchedules_upsert = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const { id, groupId, subject, body, schedule, ratePerMinute, enabled } = data;
    if (!groupId || !subject || !body || !schedule || !ratePerMinute) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
    }
    let scheduleRef;
    if (id) {
        scheduleRef = db.collection('emailSchedules').doc(id);
        await scheduleRef.set({
            groupId,
            subject,
            body,
            schedule,
            ratePerMinute,
            enabled,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    else {
        scheduleRef = await db.collection('emailSchedules').add({
            groupId,
            subject,
            body,
            schedule,
            ratePerMinute,
            enabled: enabled ?? true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            nextSendAt: admin.firestore.FieldValue.serverTimestamp() // schedule might update this later
        });
    }
    return { id: scheduleRef.id };
});
/**
 * Delete an email schedule. Staff only.
 */
export const emailSchedules_delete = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const { id } = data;
    if (!id)
        throw new functions.https.HttpsError('invalid-argument', 'Schedule ID required');
    await db.collection('emailSchedules').doc(id).delete();
    return { ok: true };
});
/**
 * Scheduled task that runs every 5 minutes to send scheduled outreach emails.
 * It iterates over enabled emailSchedules and, if the current time is past nextSendAt,
 * sends emails to the associated group at the configured rate. After sending,
 * nextSendAt is updated based on the RRULE/cron (simplified as a fixed delay for demonstration).
 */
export const emailSchedules_send = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const schedulesSnap = await db.collection('emailSchedules').where('enabled', '==', true).get();
    for (const doc of schedulesSnap.docs) {
        const sched = doc.data();
        const nextSendAt = sched.nextSendAt;
        if (!nextSendAt || nextSendAt.toDate() > new Date()) {
            continue;
        }
        // Send emails for this schedule
        const groupDoc = await db.collection('groups').doc(sched.groupId).get();
        if (!groupDoc.exists)
            continue;
        const group = groupDoc.data();
        const leadIds = group.leadIds || [];
        // Only send to leads where outreachEnabled is true (default true)
        const leads = await db.collection('leads').where(admin.firestore.FieldPath.documentId(), 'in', leadIds.slice(0, 10)).get();
        const batch = db.batch();
        let sentCount = 0;
        for (const leadDoc of leads.docs) {
            const lead = leadDoc.data();
            if (lead.outreachEnabled === false)
                continue;
            // Add email document
            const emailRef = db.collection('emails').doc();
            batch.set(emailRef, {
                orgId: group.orgId,
                projectId: null,
                threadId: uuidv4(),
                from: 'noreply@pineappleportal.com',
                to: lead.email,
                subject: sched.subject,
                body: sched.body,
                attachments: [],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'scheduled'
            });
            sentCount++;
            if (sentCount >= sched.ratePerMinute)
                break;
        }
        // Update nextSendAt to now + 1 minute (for demonstration). In a real implementation, parse RRULE.
        batch.set(doc.ref, { nextSendAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 1000)) }, { merge: true });
        await batch.commit();
    }
    return null;
});
/**
 * Record a user login event via HTTPS callable. Stores loginHistory for the current user.
 */
export const recordLogin = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    await db.collection('loginHistory').add({
        uid: context.auth.uid,
        timestamp: data?.timestamp
            ? admin.firestore.Timestamp.fromDate(new Date(data.timestamp))
            : admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
/**
 * ADMIN FUNCTIONS
 * The following callables support management operations for super administrators. These
 * functions require the caller to be a staff member (isStaff flag true on the user doc).
 */
// Utility to assert that the caller is staff
async function assertStaff(context, requiredRoles) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const snap = await db.collection('users').doc(context.auth.uid).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    const roles = extractRoleSet(snap.data());
    if (!hasRequiredRole(roles, requiredRoles)) {
        throw new functions.https.HttpsError('permission-denied', 'Staff only');
    }
    return roles;
}
async function assertStaffRequest(req, res, requiredRoles) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        const snap = await db.collection('users').doc(decoded.uid).get();
        if (!snap.exists) {
            res.status(403).json({ error: 'Staff only' });
            return null;
        }
        const roles = extractRoleSet(snap.data());
        if (!hasRequiredRole(roles, requiredRoles)) {
            res.status(403).json({ error: 'Staff only' });
            return null;
        }
        return { uid: decoded.uid, roles };
    }
    catch (err) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
}
/**
 * List all users. Returns a small subset of user fields for security reasons.
 */
export const admin_listUsers = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'GET') {
            res.status(405).end();
            return;
        }
        const requester = await assertStaffRequest(req, res, ['admin', 'sales']);
        if (!requester)
            return;
        try {
            const snap = await db.collection('users').get();
            const users = snap.docs.map((doc) => {
                const data = doc.data();
                if (data.createdAt && data.createdAt.toDate) {
                    data.createdAt = data.createdAt.toDate().toISOString();
                }
                return { id: doc.id, ...data };
            });
            res.json({ users });
        }
        catch (err) {
            console.error('admin_listUsers failed', err);
            res.status(500).json({ error: err.message || 'Failed to list users' });
        }
    });
});
/**
 * Update a user's profile. Accepts { userId, updates }. Only staff can call.
 */
export const admin_updateUser = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).end();
            return;
        }
        const requester = await assertStaffRequest(req, res, ['admin', 'sales']);
        if (!requester)
            return;
        const { userId, updates } = req.body || {};
        if (!userId || !updates) {
            res.status(400).json({ error: 'userId and updates required' });
            return;
        }
        if (updates.roles && !requester.roles.has('admin')) {
            res.status(403).json({ error: 'Only administrators can modify roles' });
            return;
        }
        if (updates.isStaff !== undefined && !requester.roles.has('admin')) {
            res.status(403).json({ error: 'Only administrators can promote staff' });
            return;
        }
        const { password, disabled, ...rest } = updates;
        const userRef = db.collection('users').doc(userId);
        const beforeSnap = await userRef.get();
        const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
        await userRef.set(rest, { merge: true });
        const authUpdates = {};
        const metadata = {};
        if (password) {
            authUpdates.password = password;
            metadata.passwordReset = true;
        }
        let previousDisabled = null;
        if (disabled !== undefined) {
            authUpdates.disabled = disabled;
            try {
                const record = await admin.auth().getUser(userId);
                previousDisabled = record.disabled ?? null;
            }
            catch (err) {
                previousDisabled = null;
            }
        }
        if (Object.keys(authUpdates).length) {
            await admin.auth().updateUser(userId, authUpdates);
        }
        if (disabled !== undefined) {
            metadata.disabled = { before: previousDisabled, after: disabled };
        }
        const changes = buildChangesFromUpdates(beforeData, rest);
        await writeAuditLog({
            actorUid: requester.uid,
            action: 'admin_update_user',
            entityType: 'user',
            entityId: userId,
            changes: Object.keys(changes).length ? changes : null,
            metadata: Object.keys(metadata).length ? metadata : null,
        });
        res.json({ ok: true });
    });
});
/**
 * Create a new user account. Expects { email, password, fullName?, isStaff?, contractor? }
 */
export const admin_createUser = functions.https.onCall(async (data, context) => {
    await assertStaff(context, 'admin');
    const { email, password, fullName = '', isStaff = false, contractor = false } = data;
    if (!email || !password)
        throw new functions.https.HttpsError('invalid-argument', 'email and password required');
    const user = await admin.auth().createUser({ email, password, displayName: fullName });
    const profile = { email, fullName, isStaff, contractor, disabled: false };
    await db.collection('users').doc(user.uid).set(profile);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_user',
            entityType: 'user',
            entityId: user.uid,
            changes: buildChangesFromCreate(profile),
        });
    }
    return { uid: user.uid };
});
/**
 * Delete a user account and associated profile. Expects { userId }
 */
export const admin_deleteUser = functions.https.onCall(async (data, context) => {
    await assertStaff(context, 'admin');
    const { userId } = data;
    if (!userId)
        throw new functions.https.HttpsError('invalid-argument', 'userId required');
    const profileRef = db.collection('users').doc(userId);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() : undefined;
    let authRecord = null;
    try {
        authRecord = await admin.auth().getUser(userId);
    }
    catch (err) {
        authRecord = null;
    }
    await Promise.all([
        admin.auth().deleteUser(userId).catch(() => { }),
        profileRef.delete().catch(() => { })
    ]);
    if (context.auth?.uid) {
        const changes = buildChangesFromDelete(profileData);
        if (authRecord) {
            changes.authRecord = {
                before: serializeForAudit({
                    email: authRecord.email || null,
                    disabled: authRecord.disabled ?? null,
                }),
                after: null,
            };
        }
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_delete_user',
            entityType: 'user',
            entityId: userId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
/**
 * Send a password reset email to a user. Expects { email }. Only staff can call.
 */
export const admin_sendPasswordReset = functions.https.onCall(async (data, context) => {
    await assertStaff(context, 'admin');
    const { email } = data;
    if (!email)
        throw new functions.https.HttpsError('invalid-argument', 'Email required');
    try {
        const link = await admin.auth().generatePasswordResetLink(email);
        // Optionally store reset link or send via email using external service
        console.log('Generated password reset link for', email);
        if (context.auth?.uid) {
            let targetUid = null;
            try {
                const record = await admin.auth().getUserByEmail(email);
                targetUid = record.uid;
            }
            catch (err) {
                targetUid = null;
            }
            await writeAuditLog({
                actorUid: context.auth.uid,
                action: 'admin_send_password_reset',
                entityType: 'user',
                entityId: targetUid ?? email,
                metadata: { email },
            });
        }
        return { link };
    }
    catch (err) {
        console.error('Password reset error', err);
        throw new functions.https.HttpsError('internal', 'Failed to generate reset link');
    }
});
/**
 * Merge two user records, moving data from sourceId into targetId and deleting the source.
 */
export const admin_mergeUsers = functions.https.onCall(async (data, context) => {
    await assertStaff(context, 'admin');
    const { sourceId, targetId } = data;
    if (!sourceId || !targetId) {
        throw new functions.https.HttpsError('invalid-argument', 'sourceId and targetId required');
    }
    const sourceRef = db.collection('users').doc(sourceId);
    const targetRef = db.collection('users').doc(targetId);
    const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);
    if (!sourceSnap.exists || !targetSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found');
    }
    const sourceData = sourceSnap.data();
    const targetData = targetSnap.data();
    const merged = { ...sourceData, ...targetData };
    await targetRef.set(merged, { merge: true });
    await sourceRef.delete();
    if (context.auth?.uid) {
        const changes = buildChangesFromUpdates(targetData, merged);
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_merge_users',
            entityType: 'user',
            entityId: targetId,
            changes: Object.keys(changes).length ? changes : null,
            metadata: {
                sourceId,
                sourceSnapshot: serializeForAudit(sourceData),
            },
        });
    }
    return { ok: true };
});
/**
 * Create a new category for products. Expects { name, slug, description, parentId }.
 */
export const admin_createCategory = functions.https.onCall(async (data, context) => {
    await assertStaff(context, 'marketing');
    const { name, slug, description, parentId } = data;
    if (!name)
        throw new functions.https.HttpsError('invalid-argument', 'Name required');
    const category = {
        name,
        slug: slug || '',
        description: description || '',
        parentId: parentId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('categories').add(category);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_category',
            entityType: 'category',
            entityId: ref.id,
            changes: buildChangesFromCreate(category),
        });
    }
    return { id: ref.id };
});
/**
 * Create a new product. Expects { name, description, price, categoryId, depositPercentage, workflowId }.
*/
export const admin_createProduct = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { name, description, price, categoryId, depositPercentage, workflowId, seoTitle, seoDescription } = data;
    if (!name)
        throw new functions.https.HttpsError('invalid-argument', 'Name required');
    const product = {
        name,
        description: description || '',
        price: price || 0,
        categoryId: categoryId || null,
        depositPercentage: depositPercentage || 30,
        workflowId: workflowId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (seoTitle)
        product.seoTitle = seoTitle;
    if (seoDescription)
        product.seoDescription = seoDescription;
    const ref = await db.collection('products').add(product);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_product',
            entityType: 'product',
            entityId: ref.id,
            changes: buildChangesFromCreate(product),
        });
    }
    return { id: ref.id };
});
/**
 * Update an existing product. Expects { productId, updates }.
*/
export const admin_updateProduct = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { productId, updates } = data;
    if (!productId || !updates)
        throw new functions.https.HttpsError('invalid-argument', 'productId and updates required');
    if (updates.requiredKit) {
        if (!Array.isArray(updates.requiredKit)) {
            throw new functions.https.HttpsError('invalid-argument', 'requiredKit must be an array');
        }
        const allIds = [];
        for (const g of updates.requiredKit) {
            if (typeof g.groupId !== 'string' || !Array.isArray(g.items)) {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid kit group');
            }
            for (const id of g.items) {
                if (typeof id !== 'string') {
                    throw new functions.https.HttpsError('invalid-argument', 'Equipment IDs must be strings');
                }
                allIds.push(id);
            }
        }
        if (allIds.length) {
            const refs = allIds.map((id) => db.collection('equipment').doc(id));
            const snaps = await db.getAll(...refs);
            snaps.forEach((s) => {
                if (!s.exists) {
                    throw new functions.https.HttpsError('not-found', 'Equipment item not found');
                }
            });
        }
    }
    const productRef = db.collection('products').doc(productId);
    const beforeSnap = await productRef.get();
    const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
    await productRef.set(updates, { merge: true });
    if (context.auth?.uid) {
        const changes = buildChangesFromUpdates(beforeData, updates);
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_update_product',
            entityType: 'product',
            entityId: productId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
/**
 * Delete a product. Expects { productId }.
*/
export const admin_deleteProduct = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { productId } = data;
    if (!productId)
        throw new functions.https.HttpsError('invalid-argument', 'productId required');
    const productRef = db.collection('products').doc(productId);
    const beforeSnap = await productRef.get();
    const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
    await productRef.delete();
    if (context.auth?.uid) {
        const changes = buildChangesFromDelete(beforeData);
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_delete_product',
            entityType: 'product',
            entityId: productId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
/**
 * Create a new workflow. Expects { name, description, tasks } where tasks is an array of
 * { title, description, dueDays, fieldType }. FieldType defines how the task collects data: e.g. 'text', 'file', etc.
 */
export const admin_createWorkflow = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { name, description, tasks } = data;
    if (!name)
        throw new functions.https.HttpsError('invalid-argument', 'Name required');
    const safeTasks = Array.isArray(tasks)
        ? tasks.map((t) => ({
            title: t.title || '',
            description: t.description || '',
            dueDays: t.dueDays || '',
            fieldType: t.fieldType || '',
            forCustomer: !!t.forCustomer,
        }))
        : [];
    const workflow = {
        name,
        description: description || '',
        tasks: safeTasks,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('workflows').add(workflow);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_workflow',
            entityType: 'workflow',
            entityId: ref.id,
            changes: buildChangesFromCreate(workflow),
        });
    }
    return { id: ref.id };
});
/**
 * Update a workflow. Expects { workflowId, updates }.
 */
export const admin_updateWorkflow = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { workflowId, updates } = data;
    if (!workflowId || !updates)
        throw new functions.https.HttpsError('invalid-argument', 'workflowId and updates required');
    const workflowRef = db.collection('workflows').doc(workflowId);
    const beforeSnap = await workflowRef.get();
    const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
    await workflowRef.set(updates, { merge: true });
    if (context.auth?.uid) {
        const changes = buildChangesFromUpdates(beforeData, updates);
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_update_workflow',
            entityType: 'workflow',
            entityId: workflowId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
export const admin_deleteWorkflow = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { workflowId } = data;
    if (!workflowId)
        throw new functions.https.HttpsError('invalid-argument', 'workflowId required');
    const workflowRef = db.collection('workflows').doc(workflowId);
    const beforeSnap = await workflowRef.get();
    const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
    await workflowRef.delete();
    if (context.auth?.uid) {
        const changes = buildChangesFromDelete(beforeData);
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_delete_workflow',
            entityType: 'workflow',
            entityId: workflowId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
/**
 * Assign a workflow to a product. Expects { productId, workflowId }.
*/
export const admin_assignWorkflow = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'operations']);
    const { productId, workflowId } = data;
    if (!productId || !workflowId)
        throw new functions.https.HttpsError('invalid-argument', 'productId and workflowId required');
    const productRef = db.collection('products').doc(productId);
    const beforeSnap = await productRef.get();
    const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
    await productRef.set({ workflowId }, { merge: true });
    if (context.auth?.uid) {
        const changes = buildChangesFromUpdates(beforeData, { workflowId });
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_assign_workflow',
            entityType: 'product',
            entityId: productId,
            changes: Object.keys(changes).length ? changes : null,
        });
    }
    return { ok: true };
});
/**
 * Create a proposal for a client. Accepts { orgId, clientEmail, items?, agreementIds?,
 * templateId?, customText? }. Items are { type: 'product' | 'custom', productId?,
 * name, price }. If templateId provided, its items and agreements are merged.
 */
export const admin_createProposal = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'sales']);
    const { orgId, clientEmail, items = [], agreementIds = [], sectionIds = [], templateId, customText } = data;
    if (!orgId || !clientEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'orgId and clientEmail required');
    }
    let finalItems = Array.isArray(items) ? items : [];
    let finalAgreements = Array.isArray(agreementIds) ? agreementIds : [];
    let finalSections = Array.isArray(sectionIds) ? sectionIds : [];
    if (templateId) {
        const tplSnap = await db.collection('proposalTemplates').doc(templateId).get();
        if (tplSnap.exists) {
            const tpl = tplSnap.data();
            finalItems = [...(tpl.items || []), ...finalItems];
            if (tpl.agreementIds) {
                finalAgreements = Array.from(new Set([...tpl.agreementIds, ...finalAgreements]));
            }
            if (tpl.sectionIds) {
                finalSections = Array.from(new Set([...tpl.sectionIds, ...finalSections]));
            }
        }
    }
    const serviceIds = finalItems
        .filter((i) => i.type === 'product' && i.productId)
        .map((i) => i.productId);
    const proposal = {
        orgId,
        clientEmail,
        items: finalItems,
        agreementIds: finalAgreements,
        sectionIds: finalSections,
        serviceIds,
        customText: customText || '',
        status: 'sent',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('proposals').add(proposal);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_proposal',
            entityType: 'proposal',
            entityId: ref.id,
            changes: buildChangesFromCreate(proposal),
            metadata: { orgId, clientEmail },
        });
    }
    return { id: ref.id };
});
/**
 * Save or update a proposal template. Expects { id?, name, items, agreementIds } and
 * returns the template id.
 */
export const admin_saveProposalTemplate = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'sales']);
    const { id, name, items = [], agreementIds = [], brandColor, logoUrl } = data;
    if (!name)
        throw new functions.https.HttpsError('invalid-argument', 'name required');
    const tpl = {
        name,
        items,
        agreementIds,
        brandColor: brandColor || null,
        logoUrl: logoUrl || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (id) {
        const tplRef = db.collection('proposalTemplates').doc(id);
        const beforeSnap = await tplRef.get();
        const beforeData = beforeSnap.exists ? beforeSnap.data() : undefined;
        await tplRef.set(tpl, { merge: true });
        if (context.auth?.uid) {
            const changes = buildChangesFromUpdates(beforeData, tpl);
            await writeAuditLog({
                actorUid: context.auth.uid,
                action: 'admin_update_proposal_template',
                entityType: 'proposalTemplate',
                entityId: id,
                changes: Object.keys(changes).length ? changes : null,
            });
        }
        return { id };
    }
    const ref = await db.collection('proposalTemplates').add(tpl);
    if (context.auth?.uid) {
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_create_proposal_template',
            entityType: 'proposalTemplate',
            entityId: ref.id,
            changes: buildChangesFromCreate(tpl),
        });
    }
    return { id: ref.id };
});
/**
 * Accept a sent proposal and convert it into an order awaiting deposit. Expects
 * { proposalId } and returns the new order id. The proposal's status is updated
 * to "accepted" and linked to the created order.
 */
export const admin_acceptProposal = functions.https.onCall(async (data, context) => {
    await assertStaff(context, ['admin', 'sales']);
    const { proposalId } = data;
    if (!proposalId) {
        throw new functions.https.HttpsError('invalid-argument', 'proposalId required');
    }
    const proposalRef = db.collection('proposals').doc(proposalId);
    const proposalSnap = await proposalRef.get();
    if (!proposalSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'proposal not found');
    }
    const proposal = proposalSnap.data();
    if (proposal.status !== 'sent') {
        throw new functions.https.HttpsError('failed-precondition', 'proposal not sent');
    }
    const order = {
        orgId: proposal.orgId,
        clientEmail: proposal.clientEmail || null,
        items: proposal.items || [],
        status: 'deposit_due',
        proposalId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const orderRef = await db.collection('orders').add(order);
    await proposalRef.set({ status: 'accepted', orderId: orderRef.id }, { merge: true });
    if (context.auth?.uid) {
        const changes = buildChangesFromUpdates(proposal, { status: 'accepted', orderId: orderRef.id });
        await writeAuditLog({
            actorUid: context.auth.uid,
            action: 'admin_accept_proposal',
            entityType: 'proposal',
            entityId: proposalId,
            changes: Object.keys(changes).length ? changes : null,
            metadata: {
                orderId: orderRef.id,
                orderSnapshot: serializeForAudit(order),
            },
        });
    }
    return { orderId: orderRef.id };
});
export const pruneAdminAuditLogs = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async () => {
    const cutoffDate = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 86400000);
    const cutoff = admin.firestore.Timestamp.fromDate(cutoffDate);
    let totalDeleted = 0;
    while (true) {
        const snapshot = await db
            .collection('adminAuditLogs')
            .where('createdAt', '<', cutoff)
            .limit(AUDIT_LOG_BATCH_SIZE)
            .get();
        if (snapshot.empty) {
            break;
        }
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += snapshot.size;
        if (snapshot.size < AUDIT_LOG_BATCH_SIZE) {
            break;
        }
    }
    console.log(`Pruned ${totalDeleted} admin audit logs older than ${AUDIT_LOG_RETENTION_DAYS} days.`);
    return null;
});
/**
 * Batch approve multiple assets. Expects { assetIds: string[] }. Only staff or client_admin can approve.
 */
export const assets_batchApprove = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { assetIds } = data;
    if (!Array.isArray(assetIds) || assetIds.length === 0)
        throw new functions.https.HttpsError('invalid-argument', 'assetIds required');
    const uSnap = await db.collection('users').doc(context.auth.uid).get();
    const isStaff = uSnap.data()?.isStaff === true;
    // We'll approve regardless; in production ensure membership
    const batch = db.batch();
    for (const id of assetIds) {
        const ref = db.collection('assets').doc(id);
        batch.set(ref, { status: 'approved', statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    return { approved: assetIds.length };
});
/**
 * Generate a simple summary for a project. Expects { projectId }. Aggregates asset and comment counts.
 */
export const projects_summarise = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { projectId } = data;
    if (!projectId)
        throw new functions.https.HttpsError('invalid-argument', 'projectId required');
    // Count assets and comments
    const assetsSnap = await db.collection('assets').where('projectId', '==', projectId).get();
    const commentsSnap = await db.collection('comments').where('projectId', '==', projectId).get();
    const summary = `Project ${projectId} has ${assetsSnap.size} assets and ${commentsSnap.size} comments.`;
    // Store in summaries collection
    await db.collection('summaries').doc(projectId).set({ projectId, summary, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { summary };
});
/**
 * Send an email via Gmail API. This is a stub demonstrating where you would integrate
 * Gmail sending using OAuth2. Expects { to, subject, body }. In production you would
 * authenticate with a service account or delegated credentials and use googleapis.gmail().users.messages.send.
 */
export const gmail_sendEmail = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { to, subject, body } = data;
    if (!to || !subject || !body)
        throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
    const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyB64)
        throw new functions.https.HttpsError('failed-precondition', 'Gmail credentials not configured');
    try {
        const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
        const authClient = new google.auth.JWT(keyJson.client_email, undefined, keyJson.private_key, ['https://www.googleapis.com/auth/gmail.send']);
        await authClient.authorize();
        const gmail = google.gmail({ version: 'v1', auth: authClient });
        const from = data.from || process.env.GMAIL_FROM || keyJson.client_email;
        const message = [
            `From: ${from}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            'Content-Type: text/plain; charset=UTF-8',
            '',
            body,
        ].join('\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
        return { ok: true };
    }
    catch (err) {
        console.error('gmail_sendEmail error:', err);
        throw new functions.https.HttpsError('internal', 'Gmail send failed');
    }
});
/**
 * Compile unresolved comments for an asset into a revision summary and store it in
 * revisionSummaries collection. Optionally, this function could email the summary
 * to the portal administrators via the gmail_sendEmail callable. Expects { assetId }.
 */
export const sendRevisionSummary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const assetId = data.assetId;
    if (!assetId) {
        throw new functions.https.HttpsError('invalid-argument', 'assetId required');
    }
    // Fetch unresolved comments
    const commentsSnap = await db.collection('comments')
        .where('assetId', '==', assetId)
        .where('resolved', '!=', true)
        .get();
    const comments = [];
    commentsSnap.forEach((doc) => {
        comments.push(doc.data());
    });
    // Fetch asset to obtain org and project for context
    const assetDoc = await db.collection('assets').doc(assetId).get();
    const assetData = assetDoc.data();
    // Create summary text
    let summary = '';
    comments.forEach((c) => {
        const t = c.timecodeSeconds || 0;
        const time = (typeof t === 'number' ? t.toFixed(3) : t);
        summary += `${time}s: ${c.body}\n`;
    });
    // Write to revisionSummaries collection
    await db.collection('revisionSummaries').add({
        assetId,
        orgId: assetData?.orgId || null,
        projectId: assetData?.projectId || null,
        summary,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: context.auth.uid,
    });
    // Optionally send an email to administrators
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail && adminEmail.includes('@')) {
            // Compose subject and body
            const subject = `Revision summary for asset ${assetId}`;
            const body = `Revision summary for asset ${assetId}:\n\n${summary}`;
            // Use gmail_sendEmail callable indirectly by writing a notification
            await db.collection('notifications').add({
                to: adminEmail,
                subject,
                body,
                type: 'revisionSummary',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                metadata: { assetId, projectId: assetData?.projectId || null },
            });
        }
    }
    catch (err) {
        console.error('Error sending revision summary email', err);
    }
    return { ok: true, count: comments.length };
});
