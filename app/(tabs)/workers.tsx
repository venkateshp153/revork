import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { calcMonthlyPay } from '@/redux/store/userSlice';

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
  Date: string;
  HoursWorked: string;
}

export default function WorkersScreen() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [clockings, setClockings] = useState<Clocking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<number>(0);

  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const isAdmin = user.profile?.designation === 'admin';
  const isManager = user.profile?.designation === 'manager';

  useEffect(() => {
    if (Date.now() - lastFetched > CACHE_TTL) {
      fetchData();
    }
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const sheetId = user.sheetId;
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

  const getWorkerInitials = (name: string) => {
    const parts = name.split(' ');
    const first = parts[0]?.charAt(0).toUpperCase() || '';
    const last = parts[1]?.charAt(0).toUpperCase() || '';
    return first + last;
  };

  const getNameHashColor = (name: string) => {
    const colors = ['#00af5bff', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getWorkerStatus = (worker: Worker) => {
    const today = new Date().toISOString().split('T')[0];
    const todayClocking = clockings.find((c) => c.WorkerID === worker.WorkerID && c.Date === today);

    if (!todayClocking) {
      return { status: 'Day Off', color: '#999' };
    }

    return { status: 'Active', color: '#4CAF50' };
  };

  const calcWorkerMonthlyEarnings = (worker: Worker) => {
    const currentMonth = new Date().getMonth();
    const workerClockings = clockings.filter((c) => {
      const date = new Date(c.Date);
      return c.WorkerID === worker.WorkerID && date.getMonth() === currentMonth;
    });

    const totalHours = workerClockings.reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
    const payPerHour = parseFloat(worker.PayPerHour as string || '0');
    return Math.round((totalHours * payPerHour) * 100) / 100;
  };

  const renderWorkerItem = ({ item }: { item: Worker }) => {
    const status = getWorkerStatus(item);
    const monthlyEarnings = calcWorkerMonthlyEarnings(item);

    return (
      <TouchableOpacity
        style={styles.workerCard}
        onPress={() => router.push(`/worker-details/${item.WorkerID}`)}
      >
        <View style={styles.workerHeader}>
          <View
            style={[
              styles.avatarContainer,
              { backgroundColor: getNameHashColor(item.Name) },
            ]}
          >
            <Text style={styles.avatarText}>{getWorkerInitials(item.Name)}</Text>
          </View>
          <View style={styles.workerInfo}>
            <Text style={styles.workerName}>{item.Name}</Text>
            <View style={styles.designationBadge}>
              <Text style={styles.designationText}>{item.Designation}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.status}</Text>
          </View>
        </View>
        <View style={styles.workerFooter}>
          <View style={styles.earningsInfo}>
            <Text style={styles.earningsLabel}>This Month</Text>
            <Text style={styles.earningsValue}>${monthlyEarnings.toFixed(2)}</Text>
          </View>
          {(isAdmin || isManager) && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => router.push(`/worker-details/${item.WorkerID}?editMode=true`)}
            >
              <MaterialCommunityIcons name="pencil" size={20} color="#00af5bff" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00af5bff" />
        <Text style={styles.loadingText}>Loading workers...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Workers List</Text>
        <Text style={styles.subtitle}>{workers.length} total workers</Text>
      </View>
      <FlatList
        data={workers}
        renderItem={renderWorkerItem}
        keyExtractor={(item) => item.WorkerID}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#00af5bff']}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  listContainer: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  workerCard: {
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
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  workerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  designationBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  designationText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00af5bff',
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  workerFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  earningsInfo: {
    flex: 1,
  },
  earningsLabel: {
    fontSize: 12,
    color: '#666',
  },
  earningsValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  editButton: {
    padding: 8,
  },
});
