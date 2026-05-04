import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { useRouter } from 'expo-router';
import { RootState } from '@/redux/store';
import { useFocusEffect } from '@react-navigation/native';
import { calcMonthlyPay } from '@/redux/store/userSlice';
import GenerateJoinLinkModal from '@/components/GenerateJoinLinkModal';

const CACHE_TTL = 5 * 60 * 1000;

interface Worker {
  WorkerID: string;
  Name: string;
  Email: string;
  Phone: string;
  PayPerHour: string;
  Designation: string;
  JoinDate: string;
  Status: string;
}

interface Clocking {
  WorkerID: string;
  Name: string;
  Date: string;
  ClockIn: string;
  ClockOut: string;
  BreakMins: string;
  HoursWorked: string;
  DayTotal: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const user = useSelector((state: RootState) => state.user);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [clockings, setClockings] = useState<Clocking[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<number>(0);
  const [joinLinkModalVisible, setJoinLinkModalVisible] = useState(false);

  const isAdmin = user.profile?.designation === 'admin';
  const isManager = user.profile?.designation === 'manager';
  const isWorker = user.designation === 'worker' || user.workerProfile?.designation === 'worker';

  const currentWorkerId = user.workerProfile?.workerId;
  const currentPayPerHour = user.workerProfile?.payPerHour || 0;

  useFocusEffect(
    React.useCallback(() => {
      if (Date.now() - lastFetched > CACHE_TTL) {
        fetchData();
      }
    }, [])
  );

  const fetchData = async () => {
    setLoading(true);
    try {
      const sheetId = user.sheetId || user.workerProfile?.sheetId;
      if (!sheetId) return;

      const [workersRes, clockingsRes] = await Promise.all([
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Workers?key=${process.env.EXPO_PUBLIC_API_KEY}`),
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Clockings?key=${process.env.EXPO_PUBLIC_API_KEY}`),
      ]);

      const workersData = await workersRes.json();
      const clockingsData = await clockingsRes.json();

      if (workersData.values) {
        const headers = workersData.values[0];
        const rows = workersData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as Worker;
        });
        setWorkers(rows);
      }

      if (clockingsData.values) {
        const headers = clockingsData.values[0];
        const rows = clockingsData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as Clocking;
        });
        setClockings(rows);
      }

      setLastFetched(Date.now());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const today = new Date().toISOString().split('T')[0];
  const todayClockings = useMemo(() => {
    return clockings.filter((c) => c.Date === today);
  }, [clockings, today]);

  const activeNowCount = useMemo(() => {
    return todayClockings.filter((c) => c.ClockIn && !c.ClockOut).length;
  }, [todayClockings]);

  const totalHoursThisWeek = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];

    return clockings
      .filter((c) => c.Date >= monday && c.Date <= today)
      .reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
  }, [clockings, today]);

  const estimatedPayrollThisMonth = useMemo(() => {
    const currentMonth = new Date().getMonth();
    const monthClockings = clockings.filter((c) => {
      const date = new Date(c.Date);
      return date.getMonth() === currentMonth;
    });

    const workerHours: Record<string, number> = {};
    monthClockings.forEach((c) => {
      workerHours[c.WorkerID] = (workerHours[c.WorkerID] || 0) + parseFloat(c.HoursWorked as string || '0');
    });

    return workers.reduce((sum, w) => {
      const hours = workerHours[w.WorkerID] || 0;
      const rate = parseFloat(w.PayPerHour as string || '0');
      return sum + hours * rate;
    }, 0);
  }, [clockings, workers]);

  const getWorkerStatus = (worker: Worker) => {
    const todayClocking = todayClockings.find((c) => c.WorkerID === worker.WorkerID);

    if (!todayClocking) {
      return { status: 'Day Off', color: '#999' };
    }

    if (todayClocking.ClockIn && !todayClocking.ClockOut) {
      return { status: 'Active', color: '#4CAF50', clockIn: todayClocking.ClockIn };
    }

    if (todayClocking.ClockIn && todayClocking.ClockOut) {
      return {
        status: 'Completed',
        color: '#2196F3',
        clockIn: todayClocking.ClockIn,
        clockOut: todayClocking.ClockOut,
      };
    }

    return { status: 'Unknown', color: '#999' };
  };

  const workerTodayData = useMemo(() => {
    if (!isWorker || !currentWorkerId) return null;

    const todayClocking = todayClockings.find((c) => c.WorkerID === currentWorkerId);
    if (!todayClocking) return null;

    const clockIn = todayClocking.ClockIn ? new Date(`1970-01-01T${todayClocking.ClockIn as string}`) : null;
    const clockOut = todayClocking.ClockOut ? new Date(`1970-01-01T${todayClocking.ClockOut as string}`) : new Date();
    const breakMins = parseFloat(todayClocking.BreakMins as string || '0');

    const hoursWorked = clockIn
      ? (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - breakMins / 60
      : 0;
    const payEarned = Math.round((hoursWorked * currentPayPerHour) * 100) / 100;

    return {
      clockIn: todayClocking.ClockIn,
      clockOut: todayClocking.ClockOut || null,
      hoursWorked: hoursWorked.toFixed(2),
      payEarned,
    };
  }, [todayClockings, currentWorkerId, isWorker, currentPayPerHour]);

  const drawerMoneyToday = useMemo(() => {
    if (!isWorker || !currentWorkerId) return 0;

    const drawer = clockings.find(
      (c) => c.WorkerID === currentWorkerId && c.Date === today && c.DayTotal
    );
    return drawer ? parseFloat(drawer.DayTotal) : 0;
  }, [clockings, currentWorkerId, isWorker, today]);

  const renderAdminDashboard = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Summary</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="account-group" size={28} color="#4CAF50" />
          <Text style={styles.summaryValue}>{workers.length}</Text>
          <Text style={styles.summaryLabel}>Total Workers</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="clock-outline" size={28} color="#2196F3" />
          <Text style={styles.summaryValue}>{totalHoursThisWeek.toFixed(1)}</Text>
          <Text style={styles.summaryLabel}>Hours This Week</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="cash" size={28} color="#FF9800" />
          <Text style={styles.summaryValue}>${estimatedPayrollThisMonth.toFixed(0)}</Text>
          <Text style={styles.summaryLabel}>Est. Payroll (Month)</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="account-check" size={28} color="#9C27B0" />
          <Text style={styles.summaryValue}>{activeNowCount}</Text>
          <Text style={styles.summaryLabel}>Active Now</Text>
        </View>
      </ScrollView>
    </View>
  );

  const renderWorkerDashboard = () => (
    <View style={styles.section}>
      <View style={styles.workerTodayCard}>
        <Text style={styles.workerTodayTitle}>Today's Summary</Text>
        {workerTodayData ? (
          <>
            <View style={styles.workerStatsRow}>
              <View style={styles.workerStat}>
                <MaterialCommunityIcons name="clock-in" size={24} color="#4CAF50" />
                <Text style={styles.workerStatLabel}>Clock In</Text>
                <Text style={styles.workerStatValue}>{workerTodayData.clockIn || '--:--'}</Text>
              </View>
              <View style={styles.workerStat}>
                <MaterialCommunityIcons name="clock-out" size={24} color="#F44336" />
                <Text style={styles.workerStatLabel}>Clock Out</Text>
                <Text style={styles.workerStatValue}>{workerTodayData.clockOut || '--:--'}</Text>
              </View>
            </View>
            <View style={styles.workerStatsRow}>
              <View style={styles.workerStat}>
                <MaterialCommunityIcons name="timer" size={24} color="#2196F3" />
                <Text style={styles.workerStatLabel}>Hours Worked</Text>
                <Text style={styles.workerStatValue}>{workerTodayData.hoursWorked} hrs</Text>
              </View>
              <View style={styles.workerStat}>
                <MaterialCommunityIcons name="cash" size={24} color="#FF9800" />
                <Text style={styles.workerStatLabel}>Pay Earned</Text>
                <Text style={styles.workerStatValue}>${workerTodayData.payEarned}</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.noDataText}>No clock-in data for today</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Drawer Money</Text>
        <View style={styles.drawerCard}>
          <Text style={styles.drawerAmount}>${drawerMoneyToday.toFixed(2)}</Text>
          <Text style={styles.drawerLabel}>Today's drawer count</Text>
        </View>
      </View>
    </View>
  );

  const renderWorkerList = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Worker Status</Text>
        {(isAdmin || isManager) && (
          <TouchableOpacity onPress={() => router.push('/(tabs)/workers')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={workers.slice(0, 5)}
        keyExtractor={(item) => item.WorkerID}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const status = getWorkerStatus(item);
          return (
            <TouchableOpacity
              style={styles.workerRow}
              onPress={() => router.push(`/worker-details/${item.WorkerID}`)}
            >
              <View style={styles.workerAvatar}>
                <Text style={styles.workerAvatarText}>
                  {item.Name.charAt(0)}{item.Name.split(' ')[1]?.charAt(0) || ''}
                </Text>
              </View>
              <View style={styles.workerInfo}>
                <Text style={styles.workerName}>{item.Name}</Text>
                <Text style={styles.workerDesignation}>{item.Designation}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                <Text style={[styles.statusText, { color: status.color }]}>{status.status}</Text>
                {status.clockIn && (
                  <Text style={styles.clockTime}>{status.clockIn}</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );

  const checkBirthdays = () => {
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    workers.forEach((worker) => {
      if (worker.JoinDate) {
        const joinDate = new Date(worker.JoinDate);
        if (joinDate.getMonth() === todayMonth && joinDate.getDate() === todayDay) {
          Alert.alert('🎂 Birthday!', `Wishing ${worker.Name} a happy birthday!`);
        }
      }
    });
  };

  useEffect(() => {
    if (workers.length > 0) {
      checkBirthdays();
    }
  }, [workers]);

  const handleGenerateJoinLink = () => {
    if (isAdmin) {
      setJoinLinkModalVisible(true);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#00af5bff']} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>{user.name || 'User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {user.profile?.designation || user.designation || 'User'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => router.push('/(tabs)/notifications')}
        >
          <MaterialCommunityIcons name="bell-outline" size={28} color="#333" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      {isWorker && workerTodayData && (
        <View style={styles.clockActions}>
          {!workerTodayData.clockOut ? (
            <TouchableOpacity style={styles.clockInButton}>
              <Text style={styles.clockButtonText}>
                {workerTodayData.clockIn ? 'Already Clocked In' : 'Clock In'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.clockOutButton}>
              <Text style={styles.clockButtonText}>Clocked Out</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(isAdmin || isManager) && renderAdminDashboard()}
      {isWorker && renderWorkerDashboard()}
      {renderWorkerList()}

      {(isAdmin || isManager) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {isAdmin && (
              <>
                <TouchableOpacity style={styles.actionCard} onPress={handleGenerateJoinLink}>
                  <MaterialCommunityIcons name="link-plus" size={28} color="#00af5bff" />
                  <Text style={styles.actionLabel}>Generate Join Link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionCard}>
                  <MaterialCommunityIcons name="calendar-plus" size={28} color="#2196F3" />
                  <Text style={styles.actionLabel}>Create Schedule</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/analytics' as any)}>
              <MaterialCommunityIcons name="chart-bar" size={28} color="#FF9800" />
              <Text style={styles.actionLabel}>Analytics</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <GenerateJoinLinkModal
        visible={joinLinkModalVisible}
        onClose={() => setJoinLinkModalVisible(false)}
      />

      {isManager && (
        <View style={styles.viewOnlyBanner}>
          <MaterialCommunityIcons name="eye" size={20} color="#666" />
          <Text style={styles.viewOnlyText}>View Only Mode</Text>
        </View>
      )}

      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00af5bff" />
        </View>
      )}
    </ScrollView>
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
  greeting: {
    fontSize: 14,
    color: '#666',
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  roleBadge: {
    backgroundColor: '#00af5bff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  notificationButton: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#F44336',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },
  clockActions: {
    padding: 16,
    backgroundColor: '#fff',
    marginTop: 8,
  },
  clockInButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  clockOutButton: {
    backgroundColor: '#F44336',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  clockButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  viewAllText: {
    fontSize: 14,
    color: '#00af5bff',
    fontWeight: '600',
  },
  summaryScroll: {
    flexDirection: 'row',
  },
  summaryCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginRight: 12,
    minWidth: 140,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  workerTodayCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  workerTodayTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  workerStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  workerStat: {
    alignItems: 'center',
    flex: 1,
  },
  workerStatLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  workerStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  noDataText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  drawerCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  drawerAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  drawerLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  workerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00af5bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  workerAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  workerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  workerDesignation: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clockTime: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
  },
  viewOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3cd',
    padding: 12,
    marginHorizontal: 20,
    borderRadius: 8,
    marginBottom: 16,
  },
  viewOnlyText: {
    fontSize: 14,
    color: '#856404',
    marginLeft: 8,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
});
