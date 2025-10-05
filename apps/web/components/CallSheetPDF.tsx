"use client";

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface CallSheetCrewMember {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface CallSheetScheduleItem {
  time?: string;
  heading: string;
  owner?: string;
  notes?: string;
}

export interface CallSheetShotItem {
  name: string;
  notes?: string;
}

export interface CallSheetContactDetails {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface CallSheetData {
  title: string;
  projectOverview?: string;
  location?: string;
  shootDate?: string;
  callTime?: string;
  wrapTime?: string;
  kitNotes?: string;
  schedule: CallSheetScheduleItem[];
  shots: CallSheetShotItem[];
  crew: CallSheetCrewMember[];
  clientContact?: CallSheetContactDetails;
  additionalNotes?: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    borderBottom: "2pt solid #111827",
    paddingBottom: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metaItem: {
    flexDirection: "column",
    marginRight: 16,
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    color: "#6B7280",
  },
  section: {
    marginBottom: 18,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    textTransform: "uppercase",
    color: "#111827",
  },
  paragraph: {
    lineHeight: 1.4,
  },
  table: {
    display: "table",
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    margin: "auto",
    flexDirection: "row",
  },
  tableCell: {
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderLeftWidth: 0,
    borderTopWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontWeight: 700,
    fontSize: 10,
    backgroundColor: "#F3F4F6",
    textTransform: "uppercase",
  },
  notesBox: {
    border: "1pt solid #D1D5DB",
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#F9FAFB",
  },
});

const normaliseLine = (value?: string | null) => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const formatDateDisplay = (value?: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatTimeDisplay = (value?: string) => {
  if (!value) return "";
  if (/^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return value;
};

interface SectionTableProps {
  headers: string[];
  rows: (string | null | undefined)[][];
}

const SectionTable = ({ headers, rows }: SectionTableProps) => (
  <View style={styles.table}>
    <View style={styles.tableRow}>
      {headers.map((header, index) => (
        <View key={index} style={[styles.tableCell, styles.tableHeaderCell]}>
          <Text>{header}</Text>
        </View>
      ))}
    </View>
    {rows.map((row, rowIndex) => (
      <View key={rowIndex} style={styles.tableRow}>
        {row.map((cell, cellIndex) => (
          <View key={cellIndex} style={styles.tableCell}>
            <Text>{normaliseLine(cell || "")}</Text>
          </View>
        ))}
      </View>
    ))}
  </View>
);

export default function CallSheetPDF({ sheet }: { sheet: CallSheetData }) {
  const scheduleRows = sheet.schedule.filter((item) => normaliseLine(item.heading)).map((item) => [
    formatTimeDisplay(item.time) || "—",
    normaliseLine(item.heading) || "—",
    normaliseLine(item.owner) || "",
    normaliseLine(item.notes) || "",
  ]);

  const crewRows = sheet.crew.filter((member) => normaliseLine(member.name)).map((member) => [
    normaliseLine(member.name) || "—",
    normaliseLine(member.role) || "",
    normaliseLine(member.phone) || "",
    normaliseLine(member.email) || "",
  ]);

  const shotRows = sheet.shots.filter((shot) => normaliseLine(shot.name)).map((shot, index) => [
    `${index + 1}`,
    normaliseLine(shot.name) || "—",
    normaliseLine(shot.notes) || "",
  ]);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{sheet.title || "Call Sheet"}</Text>
          <View style={styles.metaRow}>
            {sheet.shootDate ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Shoot Date</Text>
                <Text>{formatDateDisplay(sheet.shootDate)}</Text>
              </View>
            ) : null}
            {sheet.callTime ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Call Time</Text>
                <Text>{formatTimeDisplay(sheet.callTime)}</Text>
              </View>
            ) : null}
            {sheet.wrapTime ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Wrap</Text>
                <Text>{formatTimeDisplay(sheet.wrapTime)}</Text>
              </View>
            ) : null}
            {sheet.location ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Location</Text>
                <Text>{normaliseLine(sheet.location)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {sheet.projectOverview ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Project Overview</Text>
            <Text style={styles.paragraph}>{normaliseLine(sheet.projectOverview)}</Text>
          </View>
        ) : null}

        {scheduleRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Schedule</Text>
            <SectionTable headers={["Time", "Activity", "Owner", "Notes"]} rows={scheduleRows} />
          </View>
        ) : null}

        {shotRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Key Shots</Text>
            <SectionTable headers={["#", "Shot", "Notes"]} rows={shotRows} />
          </View>
        ) : null}

        {crewRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Crew</Text>
            <SectionTable headers={["Name", "Role", "Phone", "Email"]} rows={crewRows} />
          </View>
        ) : null}

        {sheet.kitNotes ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Kit Notes</Text>
            <Text style={styles.paragraph}>{normaliseLine(sheet.kitNotes)}</Text>
          </View>
        ) : null}

        {sheet.clientContact && (sheet.clientContact.name || sheet.clientContact.email || sheet.clientContact.phone) ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Client Contact</Text>
            <Text style={styles.paragraph}>
              {normaliseLine(sheet.clientContact.name) || "Client"}
              {sheet.clientContact.email ? ` – ${sheet.clientContact.email}` : ""}
              {sheet.clientContact.phone ? ` – ${sheet.clientContact.phone}` : ""}
            </Text>
            {sheet.clientContact.notes ? <Text style={styles.paragraph}>{normaliseLine(sheet.clientContact.notes)}</Text> : null}
          </View>
        ) : null}

        {sheet.additionalNotes ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Notes</Text>
            <View style={styles.notesBox}>
              <Text>{normaliseLine(sheet.additionalNotes)}</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
