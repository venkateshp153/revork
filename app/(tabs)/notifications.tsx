import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { Picker } from '@react-native-picker/picker';

interface Notification {
  NotifID: string;
  Type: string;
  ToWorkerID: string;
  FromUID: string;
  Title: string;
  Body: string;
  Timestamp: string;
  Read: string;
  Status: string;
}

interface LeaveRequest {
  RequestID: string;
  WorkerID: string;
  Name: string;
  StartDate: string;
  EndDate: string;
  Reason: string;
  Type: string;
  CoveringWorker: string;
  Status: string;
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);
  const [composeVisible, setComposeVisible] = useState(false);
  const [leaveRequestVisible, setLeaveRequestVisible] = useState(false);
  const [composeTitle, setComposeTitle] = useState('');
  const [composeMessage, setComposeMessage] = useState('');
  const [composeTarget, setComposeTarget] = useState('all');

  const [leaveStartDate, setLeaveStartDate] = useState('');
  const [leaveEndDate, setLeaveEndDate] = useState('');
  const [leaveType, setLeaveType] = useState('sick');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveCovering, setLeaveCovering] = useState('');

  const user = useSelector((state: RootState) => state.user);
  const isAdmin = user.profile?.designation === 'admin';
  const isManager = user.profile?.designation === 'manager';
  const isWorker = user.designation === 'worker' || user.workerProfile?.designation === 'worker';
  const currentWorkerId = user.workerProfile?.workerId;

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const sheetId = user.sheetId || user.workerProfile?.sheetId;
      if (!sheetId) return;

      const [notifRes, leaveRes] = await Promise.all([
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Notifications?key=${process.env.EXPO_PUBLIC_API_KEY}`),
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/LeaveRequests?key=${process.env.EXPO_PUBLIC_API_KEY}`),
      ]);

      const notifData = await notifRes.json();
      const leaveData = await leaveRes.json();

      if (notifData.values) {
        const headers = notifData.values[0];
        const rows = notifData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as Notification;
        });

        let filtered = rows;
        if (isWorker && currentWorkerId) {
          filtered = rows.filter((n: Notification) => n.ToWorkerID === currentWorkerId || n.Type === 'announcement');
        } else if (isManager) {
          filtered = rows.filter((n: Notification) => n.Type === 'announcement' || n.Type === 'leave_request');
        }

        setNotifications(filtered.reverse());
      }

      if (leaveData.values) {
        const headers = leaveData.values[0];
        const rows = leaveData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as LeaveRequest;
        });
        setLeaveRequests(rows.filter((r: LeaveRequest) => r.Status === 'pending'));
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleMarkRead = async (notif: Notification) => {
    setExpandedNotif(expandedNotif === notif.NotifID ? null : notif.NotifID);

    if (notif.Read === 'false') {
      try {
        const sheetId = user.sheetId || user.workerProfile?.sheetId;
        if (!sheetId) return;

        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Notifications:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              values: [[notif.NotifID, notif.Type, notif.ToWorkerID, notif.FromUID, notif.Title, notif.Body, notif.Timestamp, 'true', notif.Status]],
            }),
          }
        );

        setNotifications((prev) =>
          prev.map((n) => (n.NotifID === notif.NotifID ? { ...n, Read: 'true' } : n))
        );
      } catch (error) {
        console.error('Error updating notification:', error);
      }
    }
  };

  const handleLeaveAction = async (request: LeaveRequest, action: 'approved' | 'rejected') => {
    try {
      const sheetId = user.sheetId;
      if (!sheetId) return;

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/LeaveRequests:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [[
              request.RequestID,
              request.WorkerID,
              request.Name,
              request.StartDate,
              request.EndDate,
              request.Reason,
              request.Type,
              request.CoveringWorker,
              action,
              user.name,
              new Date().toISOString(),
            ]],
          }),
        }
      );

      const notifMessage = action === 'approved'
        ? `Your leave request from ${request.StartDate} to ${request.EndDate} has been approved.`
        : `Your leave request from ${request.StartDate} to ${request.EndDate} has been rejected.`;

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Notifications:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [[
              `NOTIF_${Date.now()}`,
              'leave_update',
              request.WorkerID,
              user.uid,
              action === 'approved' ? 'Leave Approved' : 'Leave Rejected',
              notifMessage,
              new Date().toISOString(),
              'false',
              'pending',
            ]],
          }),
        }
      );

      Alert.alert('Success', `Leave request ${action}`);
      fetchNotifications();
    } catch (error) {
      Alert.alert('Error', 'Failed to process leave request');
    }
  };

  const handleComposeAnnouncement = async () => {
    if (!composeTitle.trim() || !composeMessage.trim()) {
      Alert.alert('Error', 'Please fill in title and message');
      return;
    }

    try {
      const sheetId = user.sheetId;
      if (!sheetId) return;

      const workersRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Workers?key=${process.env.EXPO_PUBLIC_API_KEY}`);
      const workersData = await workersRes.json();

      if (workersData.values) {
        const headers = workersData.values[0];
        const workers = workersData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj;
        });

        const targets = composeTarget === 'all' ? workers : workers.filter((w: any) => w.WorkerID === composeTarget);

        for (const worker of targets) {
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Notifications:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                values: [[
                  `NOTIF_${Date.now()}_${worker.WorkerID}`,
                  'announcement',
                  worker.WorkerID,
                  user.uid,
                  composeTitle,
                  composeMessage,
                  new Date().toISOString(),
                  'false',
                  'pending',
                ]],
              }),
            }
          );
        }

        Alert.alert('Success', 'Announcement sent');
        setComposeVisible(false);
        setComposeTitle('');
        setComposeMessage('');
        setComposeTarget('all');
        fetchNotifications();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to send announcement');
    }
  };

  const handleRequestLeave = async () => {
    if (!leaveStartDate || !leaveEndDate || !leaveReason) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const sheetId = user.workerProfile?.sheetId;
      if (!sheetId) return;

      const requestId = `LR_${Date.now()}`;

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/LeaveRequests:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [[
              requestId,
              currentWorkerId,
              user.name,
              leaveStartDate,
              leaveEndDate,
              leaveReason,
              leaveType,
              leaveCovering,
              'pending',
              '',
              '',
            ]],
          }),
        }
      );

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Notifications:append?key=${process.env.EXPO_PUBLIC_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [[
              `NOTIF_${Date.now()}`,
              'leave_request',
              'admin',
              user.uid,
              `Leave Request from ${user.name}`,
              `${user.name} has requested leave from ${leaveStartDate} to ${leaveEndDate}`,
              new Date().toISOString(),
              'false',
              'pending',
            ]],
          }),
        }
      );

      Alert.alert('Success', 'Leave request submitted');
      setLeaveRequestVisible(false);
      setLeaveStartDate('');
      setLeaveEndDate('');
      setLeaveType('sick');
      setLeaveReason('');
      setLeaveCovering('');
      fetchNotifications();
    } catch (error) {
      Alert.alert('Error', 'Failed to submit leave request');
    }
  };

  const getNotificationIcon = (type: string) => {
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

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'announcement':
        return '#2196F3';
      case 'leave_request':
      case 'leave_update':
        return '#9C27B0';
      case 'birthday':
        return '#FF5722';
      default:
        return '#00af5bff';
    }
  };

  const renderNotificationItem = ({ item }: { item: Notification }) => {
    const isExpanded = expandedNotif === item.NotifID;
    const isUnread = item.Read === 'false';

    return (
      <TouchableOpacity
        style={[styles.notificationCard, isUnread && styles.unreadCard]}
        onPress={() => handleMarkRead(item)}
      >
        <View style={styles.notificationHeader}>
          <View style={[styles.iconContainer, { backgroundColor: getNotificationColor(item.Type) }]}>
            <MaterialCommunityIcons
              name={getNotificationIcon(item.Type) as any}
              size={24}
              color="#fff"
            />
          </View>
          <View style={styles.notificationContent}>
            <Text style={[styles.notificationTitle, isUnread && styles.unreadTitle]}>
              {item.Title}
            </Text>
            <Text style={styles.notificationPreview} numberOfLines={isExpanded ? undefined : 2}>
              {item.Body}
            </Text>
            <Text style={styles.notificationDate}>{new Date(item.Timestamp).toLocaleString()}</Text>
          </View>
          {isUnread && <View style={styles.unreadDot} />}
        </View>

        {item.Type === 'leave_request' && isAdmin && (
          <View style={styles.leaveActions}>
            <TouchableOpacity
              style={styles.approveButton}
              onPress={() => {
                const request = leaveRequests.find((r) => r.RequestID === item.NotifID);
                if (request) handleLeaveAction(request, 'approved');
              }}
            >
              <Text style={styles.approveButtonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={() => {
                const request = leaveRequests.find((r) => r.RequestID === item.NotifID);
                if (request) handleLeaveAction(request, 'rejected');
              }}
            >
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const unreadCount = notifications.filter((n) => n.Read === 'false').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.headerActions}>
          {isWorker && (
            <TouchableOpacity style={styles.requestLeaveButton} onPress={() => setLeaveRequestVisible(true)}>
              <MaterialCommunityIcons name="calendar-plus" size={24} color="#fff" />
            </TouchableOpacity>
          )}
          {isAdmin && (
            <TouchableOpacity style={styles.composeButton} onPress={() => setComposeVisible(true)}>
              <MaterialCommunityIcons name="plus" size={24} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Text style={styles.unreadBannerText}>{unreadCount} unread notification{unreadCount > 1 ? 's' : ''}</Text>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderNotificationItem}
        keyExtractor={(item) => item.NotifID}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="bell-off" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No notifications</Text>
          </View>
        }
      />

      <Modal visible={composeVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Compose Announcement</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Title"
              value={composeTitle}
              onChangeText={setComposeTitle}
            />
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              placeholder="Message"
              value={composeMessage}
              onChangeText={setComposeMessage}
              multiline
              numberOfLines={4}
            />
            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Send to:</Text>
              <Picker selectedValue={composeTarget} onValueChange={setComposeTarget}>
                <Picker.Item label="All Workers" value="all" />
              </Picker>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setComposeVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendButton} onPress={handleComposeAnnouncement}>
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={leaveRequestVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request Leave</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Start Date (YYYY-MM-DD)"
              value={leaveStartDate}
              onChangeText={setLeaveStartDate}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="End Date (YYYY-MM-DD)"
              value={leaveEndDate}
              onChangeText={setLeaveEndDate}
            />
            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Type:</Text>
              <Picker selectedValue={leaveType} onValueChange={setLeaveType}>
                <Picker.Item label="Sick Leave" value="sick" />
                <Picker.Item label="Holiday" value="holiday" />
                <Picker.Item label="Personal" value="personal" />
              </Picker>
            </View>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              placeholder="Reason"
              value={leaveReason}
              onChangeText={setLeaveReason}
              multiline
              numberOfLines={3}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Covering Worker (optional)"
              value={leaveCovering}
              onChangeText={setLeaveCovering}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setLeaveRequestVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendButton} onPress={handleRequestLeave}>
                <Text style={styles.sendButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  headerActions: {
    flexDirection: 'row',
  },
  requestLeaveButton: {
    backgroundColor: '#00af5bff',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  composeButton: {
    backgroundColor: '#00af5bff',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBanner: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    alignItems: 'center',
  },
  unreadBannerText: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  notificationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#00af5bff',
  },
  notificationHeader: {
    flexDirection: 'row',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  unreadTitle: {
    color: '#00af5bff',
  },
  notificationPreview: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  notificationDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00af5bff',
    marginLeft: 8,
    marginTop: 4,
  },
  leaveActions: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  approveButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  approveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#F44336',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  modalTextarea: {
    height: 100,
    textAlignVertical: 'top',
  },
  pickerContainer: {
    marginBottom: 12,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 16,
  },
  sendButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#00af5bff',
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
