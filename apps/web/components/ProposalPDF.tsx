"use client";

import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { VAT_RATE } from "@/lib/vat";

interface ProposalItem {
  name: string;
  price: number;
  notes?: string;
  product?: { storyboardImages?: string[] };
  rentalTotal?: number;
}

interface Section {
  title: string;
  content: string;
}

interface ProposalPDFProps {
  proposal: {
    name: string;
    items: ProposalItem[];
    sections?: Section[];
    terms?: string;
    brandColor?: string;
    logoUrl?: string;
    customText?: string;
  };
}

export default function ProposalPDF({ proposal }: ProposalPDFProps) {
  const total = proposal.items?.reduce((sum, it) => sum + (it.price || 0), 0) || 0;
  const rentalSum = proposal.items?.reduce((sum, it) => sum + (it.rentalTotal || 0), 0) || 0;
  const net = total + rentalSum;
  const vat = net * VAT_RATE;
  const gross = net + vat;
  const styles = StyleSheet.create({
    page: { padding: 24, fontSize: 12 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      padding: 8,
      marginBottom: 12,
    },
    logo: { width: 64, height: 64, marginRight: 12 },
    title: { fontSize: 20, fontWeight: 700 },
    itemRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 12,
      borderTop: "1pt solid #000",
      paddingTop: 8,
      fontWeight: 700,
    },
    sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
    productImage: { width: 256, height: 144, marginVertical: 4 },
  });

  const toc = [
    ...(proposal.sections || []).map((s) => s.title),
    ...proposal.items.map((it) => it.name),
    proposal.terms ? ["Terms & Conditions"] : [],
  ].flat();

  const headerStyle = proposal.brandColor
    ? [styles.header, { backgroundColor: proposal.brandColor }]
    : [styles.header];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={headerStyle}>
          {proposal.logoUrl && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={proposal.logoUrl} style={styles.logo} />
          )}
          <Text style={styles.title}>{proposal.name || "Proposal"}</Text>
        </View>
        {proposal.customText && <Text>{proposal.customText}</Text>}
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Contents</Text>
        {toc.map((t, i) => (
          <Text key={i}>- {t}</Text>
        ))}
      </Page>

      {(proposal.sections || []).map((s, idx) => (
        <Page key={`sec-${idx}`} size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          <Text>{s.content}</Text>
        </Page>
      ))}

      {proposal.items.map((it, idx) => (
        <Page key={`item-${idx}`} size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>{it.name}</Text>
          {it.notes && <Text>{it.notes}</Text>}
          {it.product?.storyboardImages?.map((url, i) => (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image key={i} src={url} style={styles.productImage} />
          ))}
          <View style={[styles.totalRow, { marginTop: 16 }]}>
            <Text>Price</Text>
            <Text>£{(it.price || 0).toFixed(2)}</Text>
          </View>
          {typeof it.rentalTotal === 'number' && (
            <View style={styles.itemRow}>
              <Text>Rental</Text>
              <Text>£{(it.rentalTotal || 0).toFixed(2)}</Text>
            </View>
          )}
        </Page>
      ))}

      {proposal.terms && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>Terms & Conditions</Text>
          <Text>{proposal.terms}</Text>
        </Page>
      )}

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Summary</Text>
        {proposal.items?.map((it, idx) => (
          <View key={idx} style={styles.itemRow}>
            <Text>{it.name}</Text>
            <Text>£{(it.price || 0).toFixed(2)}</Text>
          </View>
        ))}
        {rentalSum > 0 && (
          <View style={styles.itemRow}>
            <Text>Rental Subtotal</Text>
            <Text>£{rentalSum.toFixed(2)}</Text>
          </View>
        )}
        <View style={styles.itemRow}>
          <Text>Subtotal</Text>
          <Text>£{net.toFixed(2)}</Text>
        </View>
        <View style={styles.itemRow}>
          <Text>VAT (20%)</Text>
          <Text>£{vat.toFixed(2)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text>Total</Text>
          <Text>£{gross.toFixed(2)}</Text>
        </View>
      </Page>
    </Document>
  );
}

