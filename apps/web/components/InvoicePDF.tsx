"use client";

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

interface InvoiceItem {
  description: string;
  amount: number;
  productId?: string | null;
}

interface InvoicePDFProps {
  invoice: {
    id: string;
    organisationName: string;
    clientName?: string;
    clientEmail?: string;
    dueDate?: string | null;
    items: InvoiceItem[];
    total: number;
    paymentTerms?: string;
    notes?: string;
  };
}

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 12,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: "#6B7280",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 24,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 12,
  },
  total: {
    fontSize: 14,
    fontWeight: 700,
  },
  notes: {
    marginTop: 12,
    fontSize: 11,
    color: "#4B5563",
  },
});

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(value);

export default function InvoicePDF({ invoice }: InvoicePDFProps) {
  const dueLabel = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString()
    : "Due on receipt";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Invoice {invoice.id}</Text>
          <Text style={styles.subtitle}>{invoice.organisationName}</Text>
          {invoice.clientName ? <Text style={styles.subtitle}>Client: {invoice.clientName}</Text> : null}
          {invoice.clientEmail ? <Text style={styles.subtitle}>Email: {invoice.clientEmail}</Text> : null}
        </View>

        <View>
          <Text style={styles.sectionTitle}>Line items</Text>
          {invoice.items.map((item, index) => (
            <View key={index} style={styles.row}>
              <View>
                <Text>{item.description || `Item ${index + 1}`}</Text>
                {item.productId ? <Text style={styles.subtitle}>Ref: {item.productId}</Text> : null}
              </View>
              <Text>{formatCurrency(item.amount)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.total}>Total</Text>
            <Text style={styles.total}>{formatCurrency(invoice.total)}</Text>
          </View>
          <View style={styles.row}>
            <Text>Due date</Text>
            <Text>{dueLabel}</Text>
          </View>
        </View>

        {invoice.paymentTerms ? (
          <View>
            <Text style={styles.sectionTitle}>Payment terms</Text>
            <Text>{invoice.paymentTerms}</Text>
          </View>
        ) : null}

        {invoice.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notes}>{invoice.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
