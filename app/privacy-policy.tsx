import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

const SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@revork.app';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

/**
 * Offline copy of the privacy policy. Play Store reviewers and users can reach
 * it from Profile even when the hosted policy URL is not configured.
 */
export default function PrivacyPolicyScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy policy</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.updated}>Last updated: 23 November 2026</Text>
        <Paragraph>
          Revork is a workforce and delivery management app used by companies
          and their employees. This policy explains what data the app collects,
          why, and how it is handled.
        </Paragraph>

        <Section title="Data we collect">
          <Paragraph>
            • Account data: name, email address, profile photo, phone number and
            role.
          </Paragraph>
          <Paragraph>
            • Company data: company name, address, phone, email and workspace
            files.
          </Paragraph>
          <Paragraph>
            • Delivery data: delivery addresses, receiver names and phone
            numbers, order counts, delivery status, notes and delivery proof
            photos.
          </Paragraph>
          <Paragraph>
            • Location data: approximate or precise device location while the
            app is in use, used to build routes, find the next stop and record
            proof check-in.
          </Paragraph>
          <Paragraph>
            • Attendance and payroll data: clock-in/out times, worked hours and
            pay rates entered by the company.
          </Paragraph>
          <Paragraph>
            • Inventory data: item names, categories, quantities, low-stock
            levels and notes.
          </Paragraph>
          <Paragraph>We do not sell personal data.</Paragraph>
        </Section>

        <Section title="How data is used">
          <Paragraph>• To sign users in and connect them to their company workspace.</Paragraph>
          <Paragraph>• To build, optimize and track delivery routes.</Paragraph>
          <Paragraph>• To record deliveries, proof photos and attendance.</Paragraph>
          <Paragraph>• To show company, team and inventory information inside the app.</Paragraph>
          <Paragraph>• To send in-app alerts and notifications.</Paragraph>
          <Paragraph>• To keep the service secure and troubleshoot failures.</Paragraph>
        </Section>

        <Section title="Where data is stored">
          <Paragraph>
            Company workspace data is stored in the company&apos;s Google Sheets
            and Google Drive folder. Account and tracking data may be stored in
            Google Firebase. Device permissions and local files are used for
            photos and offline support.
          </Paragraph>
          <Paragraph>
            Google&apos;s privacy policy applies to Google services:
            https://policies.google.com/privacy
          </Paragraph>
        </Section>

        <Section title="Sharing">
          <Paragraph>
            Data is visible to the company that owns the workspace and to users
            the company authorizes. We do not share personal data with
            advertisers or unrelated third parties. Service providers such as
            Google Cloud, Firebase and Google Maps process data to provide the
            service. Workspace spreadsheets are private and are shared only with
            the Google accounts the company adds.
          </Paragraph>
        </Section>

        <Section title="Retention and deletion">
          <Paragraph>
            Company workspace data is retained for as long as the company keeps
            it. Users can delete their personal account from Profile → Privacy
            &amp; account → Delete my account. Account deletion removes the
            personal profile and sign-in. Company workspace files belong to the
            company and are not deleted by an employee account deletion.
          </Paragraph>
          <Paragraph>
            To request deletion of company data, contact the company
            administrator or {SUPPORT_EMAIL}.
          </Paragraph>
        </Section>

        <Section title="Security">
          <Paragraph>
            Data is transmitted over HTTPS. Access to a workspace is limited by
            Google account permissions and app roles. No method of transmission
            or storage is completely secure, but we take reasonable measures to
            protect data.
          </Paragraph>
        </Section>

        <Section title="Children">
          <Paragraph>
            Revork is a workplace app and is not directed to children under 13.
          </Paragraph>
        </Section>

        <Section title="Changes">
          <Paragraph>
            We may update this policy. The updated date is shown at the top of
            this page.
          </Paragraph>
        </Section>

        <Section title="Contact">
          <Paragraph>{SUPPORT_EMAIL}</Paragraph>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  content: { padding: 20, paddingBottom: 40 },
  updated: { fontSize: 11, color: '#94A3B8', marginBottom: 14 },
  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    marginBottom: 7,
  },
});
