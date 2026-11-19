import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { useFocusEffect } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  isAlertActive,
  sendAlert,
} from '@/src/utils/notifications';
import {
  appendSheetRow,
  fetchSheetRows,
  getGoogleAccessToken,
  updateSheetRange,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
  parseBirthday,
} from '@/src/utils/workerManagement';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function AlertsScreen() {
  const user = useSelector((state: RootState) => state.user);

  const [alerts, setAlerts] = useState<SheetRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<SheetRow[]>([]);
  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [composeVisible, setComposeVisible] = useState(false);
  const [composeTitle, setComposeTitle] = useState('');
  const [composeMessage, setComposeMessage] = useState('');
  const [composeTarget, setComposeTarget] = useState('all');
  const [composeDuration, setComposeDuration] = useState('24');
  const [composeNotes, setComposeNotes] = useState('');

  const [leaveVisible, setLeaveVisible] = useState(false);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveType, setLeaveType] = useState('sick');
  const [leaveReason, setLeaveReason] = useState('');

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const currentWorkerId = user.workerProfile?.workerId;

  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        currentWorkerId,
        user.email || user.workerProfile?.email
      ),
    [workers, currentWorkerId, user.email, user.workerProfile?.email]
  );
  const myWorkerId = currentWorkerId || myRow?.WorkerID || '';
  const myName = myRow?.Name || user.name || 'Employee';
  const myEmail = myRow?.Email || user.email || '';

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const isEmployee = !isAdmin && !isManager;
  const theme = getRoleTheme(designation, isEmployee);
  const canCompose = isAdmin || isManager;

  const fetchData = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [notificationRows, leaveRows, workerRows] = await Promise.all([
        fetchSheetRows(sheetId, 'Notifications'),
        fetchSheetRows(sheetId, 'LeaveRequests'),
        fetchSheetRows(sheetId, 'Workers'),
      ]);

      const visibleAlerts = (
        isEmployee
          ? notificationRows.filter(
              (row) =>
                row.ToWorkerID === myWorkerId ||
                row.ToWorkerID === 'all'
            )
          : notificationRows
      ).filter(isAlertActive);

      setAlerts(
        visibleAlerts
          .slice()
          .sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''))
      );
      setLeaveRequests(leaveRows);
      setWorkers(workerRows);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sheetId, isEmployee, myWorkerId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const celebrations = useMemo(() => {
    const month = new Date().getMonth() + 1;
    return workers
      .map((worker) => {
        const birthday = parseBirthday(worker.Birthday);
        if (birthday && birthday.month === month) {
          return {
            id: `b-${worker.WorkerID}`,
            name: worker.Name,
            label: 'Birthday',
            day: birthday.day,
            icon: 'cake-variant',
            color: '#DB2777',
          };
        }
        if (worker.JoinDate) {
          const joined = new Date(worker.JoinDate);
          if (joined.getMonth() + 1 === month) {
            return {
              id: `a-${worker.WorkerID}`,
              name: worker.Name,
              label: 'Work anniversary',
              day: joined.getDate(),
              icon: 'party-popper',
              color: '#7C3AED',
            };
          }
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, 6) as {
      id: string;
      name: string;
      label: string;
      day: number;
      icon: string;
      color: string;
    }[];
  }, [workers]);

  const monthEvents = useMemo(() => {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    return leaveRequests.filter((row) => {
      if (!row.StartDate) return false;
      const start = new Date(row.StartDate);
      const end = row.EndDate ? new Date(row.EndDate) : start;
      return (
        (start.getMonth() + 1 === month && start.getFullYear() === year) ||
        (end.getMonth() + 1 === month && end.getFullYear() === year)
      );
    });
  }, [leaveRequests]);

  const unreadCount = alerts.filter((row) => row.Read === 'false').length;

  const handleMarkRead = async (alert: SheetRow) => {
    setExpanded(expanded === alert.NotifID ? null : alert.NotifID);
    if (alert.Read !== 'false' || !alert._row) return;
    try {
      const token = await getGoogleAccessToken(false);
      if (!token) return;
      await updateSheetRange(
        sheetId,
        `Notifications!H${alert._row}`,
        [['true']],
        token
      );
      setAlerts((prev) =>
        prev.map((row) =>
          row.NotifID === alert.NotifID ? { ...row, Read: 'true' } : row
        )
      );
    } catch (error) {
      console.error('Unable to mark alert as read:', error);
    }
  };

  const handleCompose = async () => {
    if (!composeTitle.trim() || !composeMessage.trim()) {
      Alert.alert('Missing info', 'Please add a title and message.');
      return;
    }
    setSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) throw new Error('Sign in with Google to send an alert.');

      const targets =
        composeTarget === 'all'
          ? ['all']
          : [composeTarget];

      for (const target of targets) {
        await sendAlert({
          sheetId,
          token,
          target,
          title: composeTitle,
          body: composeMessage,
          durationHours: parseFloat(composeDuration) || 24,
          notes: composeNotes,
          fromUid: user.uid || '',
        });
      }
      setComposeVisible(false);
      setComposeTitle('');
      setComposeMessage('');
      setComposeTarget('all');
      setComposeDuration('24');
      setComposeNotes('');
      await fetchData();
      Alert.alert('Alert sent', 'Your team will see it in Alerts.');
    } catch (error: any) {
      Alert.alert('Unable to send', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLeaveRequest = async () => {
    if (!leaveStart || !leaveEnd || !leaveReason.trim()) {
      Alert.alert('Missing info', 'Add start date, end date and a reason.');
      return;
    }
    setSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!myWorkerId) throw new Error('Your employee record was not found.');

      const requestId = `LR_${Date.now()}`;
      await appendSheetRow(
        sheetId,
        'LeaveRequests',
        [
          requestId,
          myWorkerId,
          myName,
          leaveStart,
          leaveEnd,
          leaveReason.trim(),
          leaveType,
          '',
          'pending',
          '',
          '',
        ],
        token
      );

      await appendSheetRow(
        sheetId,
        'Notifications',
        [
          requestId,
          'leave_request',
          'admin',
          user.uid || myEmail,
          `Leave request · ${myName}`,
          `${myName} requested ${leaveType} leave from ${leaveStart} to ${leaveEnd}.`,
          new Date().toISOString(),
          'false',
          'pending',
        ],
        token
      );

      setLeaveVisible(false);
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
      await fetchData();
      Alert.alert('Request sent', 'Your admin can review it in Alerts.');
    } catch (error: any) {
      Alert.alert('Unable to submit', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLeaveDecision = async (
    request: SheetRow,
    decision: 'approved' | 'rejected'
  ) => {
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) throw new Error('Sign in with Google to review leave.');

      if (request._row) {
        await updateSheetRange(
          sheetId,
          `LeaveRequests!I${request._row}:K${request._row}`,
          [[decision, user.name || 'Admin', new Date().toISOString()]],
          token
        );
      }

      await appendSheetRow(
        sheetId,
        'Notifications',
        [
          `NOTIF_${Date.now()}`,
          'leave_update',
          request.WorkerID,
          user.uid || '',
          decision === 'approved' ? 'Leave approved' : 'Leave rejected',
          `Your leave request (${request.StartDate} → ${request.EndDate}) was ${decision}.`,
          new Date().toISOString(),
          'false',
          decision,
        ],
        token
      );

      await fetchData();
      Alert.alert('Updated', `Leave ${decision}.`);
    } catch (error: any) {
      Alert.alert('Unable to update', error?.message || 'Try again.');
    }
  };

  const pendingLeave = leaveRequests.filter(
    (row) => row.Status === 'pending'
  );

  const iconFor = (type: string) => {
    switch (type) {
      case 'announcement':
        return 'bullhorn';
      case 'leave_request':
      case 'leave_update':
        return 'calendar-check';
      case 'birthday':
        return 'cake-variant';
      default:
        return 'bell';
    }
  };

  const colorFor = (type: string) => {
    switch (type) {
      case 'announcement':
        return '#2563EB';
      case 'leave_request':
      case 'leave_update':
        return '#8B5CF6';
      case 'birthday':
        return '#DB2777';
      default:
        return theme.accent;
    }
  };

  const renderAlert = ({ item }: { item: SheetRow }) => {
    const open = expanded === item.NotifID;
    const unread = item.Read === 'false';
    return (
      <TouchableOpacity
        style={[styles.alertCard, unread && { borderLeftWidth: 4, borderLeftColor: theme.accent }]}
        onPress={() => handleMarkRead(item)}
        activeOpacity={0.85}
      >
        <View style={styles.alertTop}>
          <View style={[styles.alertIcon, { backgroundColor: colorFor(item.Type) }]}>
            <MaterialCommunityIcons
              name={iconFor(item.Type) as any}
              size={20}
              color="#fff"
            />
          </View>
          <View style={styles.alertBody}>
            <View style={styles.alertTitleRow}>
              <Text style={styles.alertTitle}>{item.Title}</Text>
              {unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
            </View>
            <Text
              style={styles.alertMessage}
              numberOfLines={open ? undefined : 2}
            >
              {item.Body}
            </Text>
            <Text style={styles.alertTime}>
              {item.Timestamp
                ? new Date(item.Timestamp).toLocaleString()
                : 'Just now'}
            </Text>
            {!!item.Notes && (
              <Text style={styles.alertNotes}>Note: {item.Notes}</Text>
            )}
            {!!item.ExpiresAt && (
              <Text style={styles.alertExpiry}>
                Visible until {new Date(item.ExpiresAt).toLocaleString()}
              </Text>
            )}
          </View>
        </View>

        {item.Type === 'leave_request' &&
          (isAdmin || isManager) &&
          item.Status === 'pending' && (
            <View style={styles.leaveActions}>
              {(() => {
                return (
                  <View style={styles.leaveActionRow}>
                    <TouchableOpacity
                      style={styles.approveButton}
                      onPress={() => {
                        const match =
                          leaveRequests.find(
                            (row) => row.RequestID === item.NotifID
                          ) ||
                          leaveRequests.find(
                            (row) =>
                              row.WorkerID === item.FromUID &&
                              row.Status === 'pending'
                          );
                        if (match) handleLeaveDecision(match, 'approved');
                        else Alert.alert('Not found', 'Open the leave sheet to review this request.');
                      }}
                    >
                      <Text style={styles.approveText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => {
                        const match =
                          leaveRequests.find(
                            (row) => row.RequestID === item.NotifID
                          ) ||
                          leaveRequests.find(
                            (row) =>
                              row.WorkerID === item.FromUID &&
                              row.Status === 'pending'
                          );
                        if (match) handleLeaveDecision(match, 'rejected');
                        else Alert.alert('Not found', 'Open the leave sheet to review this request.');
                      }}
                    >
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
            </View>
          )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>Loading alerts…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.title, { color: theme.headerText }]}>Alerts</Text>
            <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
              {unreadCount > 0
                ? `${unreadCount} unread · ${MONTH_NAMES[new Date().getMonth()]}`
                : `Team updates · ${MONTH_NAMES[new Date().getMonth()]}`}
            </Text>
          </View>
          <View style={styles.headerButtons}>
            {isEmployee && (
              <TouchableOpacity
                style={[styles.headerButton, { backgroundColor: theme.accent }]}
                onPress={() => setLeaveVisible(true)}
              >
                <MaterialCommunityIcons name="calendar-plus" size={18} color="#fff" />
              </TouchableOpacity>
            )}
            {canCompose && (
              <TouchableOpacity
                style={[styles.headerButton, { backgroundColor: theme.accent }]}
                onPress={() => setComposeVisible(true)}
              >
                <MaterialCommunityIcons name="plus" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <FlatList
        data={alerts}
        renderItem={renderAlert}
        keyExtractor={(item) => item.NotifID || `${item._row}`}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchData();
            }}
            colors={[theme.accent]}
          />
        }
        ListHeaderComponent={
          <>
            {(celebrations.length > 0 || monthEvents.length > 0) && (
              <View style={styles.celebrationSection}>
                <Text style={styles.sectionTitle}>
                  This month in your team
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.celebrationScroll}
                >
                  {celebrations.map((event) => (
                    <View key={event.id} style={styles.celebrationCard}>
                      <View style={[styles.celebrationIcon, { backgroundColor: `${event.color}18` }]}>
                        <MaterialCommunityIcons
                          name={event.icon as any}
                          size={20}
                          color={event.color}
                        />
                      </View>
                      <Text style={styles.celebrationName} numberOfLines={1}>
                        {event.name}
                      </Text>
                      <Text style={styles.celebrationLabel}>{event.label}</Text>
                      <Text style={[styles.celebrationDay, { color: event.color }]}>
                        {MONTH_NAMES[new Date().getMonth()].slice(0, 3)} {event.day}
                      </Text>
                    </View>
                  ))}
                  {monthEvents.map((event) => (
                    <View key={`e-${event.RequestID}`} style={styles.celebrationCard}>
                      <View style={[styles.celebrationIcon, { backgroundColor: '#2563EB18' }]}>
                        <MaterialCommunityIcons
                          name="airplane-takeoff"
                          size={20}
                          color="#2563EB"
                        />
                      </View>
                      <Text style={styles.celebrationName} numberOfLines={1}>
                        {event.Name}
                      </Text>
                      <Text style={styles.celebrationLabel}>Leave</Text>
                      <Text style={[styles.celebrationDay, { color: '#2563EB' }]}>
                        {event.StartDate?.slice(5) || ''}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {(isAdmin || isManager) && pendingLeave.length > 0 && (
              <View style={styles.pendingCard}>
                <MaterialCommunityIcons name="calendar-clock" size={20} color="#B45309" />
                <Text style={styles.pendingText}>
                  {pendingLeave.length} leave request
                  {pendingLeave.length > 1 ? 's' : ''} waiting for review
                </Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="bell-sleep-outline" size={52} color="#CBD5E0" />
            <Text style={styles.emptyText}>No alerts yet</Text>
            <Text style={styles.emptySubText}>
              {canCompose
                ? 'Create one to keep your team informed'
                : 'Announcements from your admin will appear here'}
            </Text>
          </View>
        }
      />

      <Modal visible={composeVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create alert</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Title"
              placeholderTextColor="#94A3B8"
              value={composeTitle}
              onChangeText={setComposeTitle}
            />
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              placeholder="Write your message…"
              placeholderTextColor="#94A3B8"
              value={composeMessage}
              onChangeText={setComposeMessage}
              multiline
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Show for how many hours? (e.g. 24)"
              placeholderTextColor="#94A3B8"
              value={composeDuration}
              onChangeText={setComposeDuration}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.modalInput, styles.modalNote]}
              placeholder="Internal note (optional)"
              placeholderTextColor="#94A3B8"
              value={composeNotes}
              onChangeText={setComposeNotes}
            />
            <Text style={styles.pickerLabel}>Send to</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={composeTarget}
                onValueChange={setComposeTarget}
              >
                <Picker.Item label="Everyone" value="all" />
                {workers.map((worker) => (
                  <Picker.Item
                    key={worker.WorkerID}
                    label={worker.Name}
                    value={worker.WorkerID}
                  />
                ))}
              </Picker>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setComposeVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.accent }]}
                onPress={handleCompose}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send alert</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={leaveVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request leave</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Start date (YYYY-MM-DD)"
              placeholderTextColor="#94A3B8"
              value={leaveStart}
              onChangeText={setLeaveStart}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="End date (YYYY-MM-DD)"
              placeholderTextColor="#94A3B8"
              value={leaveEnd}
              onChangeText={setLeaveEnd}
            />
            <Text style={styles.pickerLabel}>Type</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={leaveType} onValueChange={setLeaveType}>
                <Picker.Item label="Sick leave" value="sick" />
                <Picker.Item label="Holiday" value="holiday" />
                <Picker.Item label="Personal" value="personal" />
              </Picker>
            </View>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              placeholder="Reason"
              placeholderTextColor="#94A3B8"
              value={leaveReason}
              onChangeText={setLeaveReason}
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setLeaveVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.accent }]}
                onPress={handleLeaveRequest}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 4 },
  headerButtons: { flexDirection: 'row' },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  listContainer: { padding: 16, paddingBottom: 100 },
  celebrationSection: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 10,
  },
  celebrationScroll: { flexDirection: 'row' },
  celebrationCard: {
    width: 118,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginRight: 10,
  },
  celebrationIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrationName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 8,
  },
  celebrationLabel: { fontSize: 10, color: '#64748B', marginTop: 1 },
  celebrationDay: { fontSize: 10, fontWeight: '800', marginTop: 4 },
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  pendingText: { flex: 1, fontSize: 12, color: '#92400E', marginLeft: 8, fontWeight: '600' },
  alertCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  alertTop: { flexDirection: 'row' },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBody: { flex: 1, marginLeft: 12 },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center' },
  alertTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    flex: 1,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 6 },
  alertMessage: { fontSize: 12, color: '#475569', lineHeight: 18, marginTop: 3 },
  alertTime: { fontSize: 10, color: '#94A3B8', marginTop: 6 },
  alertNotes: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
    marginTop: 4,
  },
  alertExpiry: { fontSize: 10, color: '#B45309', marginTop: 4 },
  leaveActions: { marginTop: 10 },
  leaveActionRow: { flexDirection: 'row' },
  approveButton: {
    flex: 1,
    backgroundColor: '#DCFCE7',
    padding: 9,
    borderRadius: 9,
    alignItems: 'center',
    marginRight: 6,
  },
  approveText: { color: '#15803D', fontWeight: '800', fontSize: 12 },
  rejectButton: {
    flex: 1,
    backgroundColor: '#FEE2E2',
    padding: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  rejectText: { color: '#B91C1C', fontWeight: '800', fontSize: 12 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: '#64748B', marginTop: 12, fontWeight: '700' },
  emptySubText: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 14,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 11,
    marginBottom: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  modalTextarea: { height: 92, textAlignVertical: 'top' },
  modalNote: { fontStyle: 'italic' },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  modalButtons: { flexDirection: 'row', marginTop: 8 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  primaryButton: {
    flex: 1,
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F6F8F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 12, color: '#64748B', fontSize: 13 },
});
