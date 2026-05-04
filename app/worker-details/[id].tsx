import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { BarChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';

const screenWidth = Dimensions.get('window').width;

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

interface DrawerMoney {
  WorkerID: string;
  Name: string;
  Date: string;
  DrawerAmount: string;
  Notes: string;
  PhotoURL: string;
}

export default function WorkerDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const workerId = params.id as string;
  const editModeParam = params.editMode === 'true';

  const [isEditing, setIsEditing] = useState(editModeParam);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [payPerHour, setPayPerHour] = useState('0');
  const [clockings, setClockings] = useState<Clocking[]>([]);
  const [drawerMoney, setDrawerMoney] = useState<DrawerMoney[]>([]);
  const [loading, setLoading] = useState(false);

  const isAdmin = user.profile?.designation === 'admin';
  const isWorker = user.designation === 'worker' || user.workerProfile?.designation === 'worker';
  const currentWorkerId = user.workerProfile?.workerId;

  useEffect(() => {
    if (isWorker && workerId !== currentWorkerId) {
      Alert.alert('Access Denied', 'You can only view your own data');
      router.back();
    }
  }, [workerId, currentWorkerId, isWorker]);

  useEffect(() => {
    fetchData();
  }, [selectedMonth, selectedYear]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const sheetId = user.sheetId || user.workerProfile?.sheetId;
      if (!sheetId) return;

      const [clockingsRes, drawerRes] = await Promise.all([
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Clockings?key=${process.env.EXPO_PUBLIC_API_KEY}`),
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/DrawerMoney?key=${process.env.EXPO_PUBLIC_API_KEY}`),
      ]);

      const clockingsData = await clockingsRes.json();
      const drawerData = await drawerRes.json();

      if (clockingsData.values) {
        const headers = clockingsData.values[0];
        const rows = clockingsData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as Clocking;
        });
        
        const filtered = rows.filter((c: Clocking) => {
          const date = new Date(c.Date);
          return c.WorkerID === workerId && date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
        });
        setClockings(filtered);
      }

      if (drawerData.values) {
        const headers = drawerData.values[0];
        const rows = drawerData.values.slice(1).map((row: string[]) => {
          const obj: any = {};
          headers.forEach((h: string, i: number) => (obj[h] = row[i]));
          return obj as DrawerMoney;
        });
        
        const filtered = rows.filter((d: DrawerMoney) => {
          const date = new Date(d.Date);
          return d.WorkerID === workerId && date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
        });
        setDrawerMoney(filtered);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  const totalHours = useMemo(() => {
    return clockings.reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
  }, [clockings]);

  const totalPay = useMemo(() => {
    return Math.round((totalHours * parseFloat(payPerHour as string || '0')) * 100) / 100;
  }, [totalHours, payPerHour]);

  const totalBreakTime = useMemo(() => {
    return clockings.reduce((sum, c) => sum + parseFloat(c.BreakMins as string || '0'), 0);
  }, [clockings]);

  const avgHoursPerDay = useMemo(() => {
    return clockings.length > 0 ? totalHours / clockings.length : 0;
  }, [totalHours, clockings]);

  const attendanceRate = useMemo(() => {
    const workingDays = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const daysWorked = clockings.length;
    return Math.round((daysWorked / workingDays) * 100);
  }, [clockings, selectedMonth, selectedYear]);

  const chartData = useMemo(() => {
    const daysData: Record<number, number> = {};
    clockings.forEach((c) => {
      const day = new Date(c.Date).getDate();
      daysData[day] = (daysData[day] || 0) + parseFloat(c.HoursWorked as string || '0');
    });

    return {
      labels: Object.keys(daysData).map(String),
      datasets: [{ data: Object.values(daysData) }],
    };
  }, [clockings]);

  const handleSavePayRate = () => {
    Alert.alert('Success', 'Pay rate updated');
    setIsEditing(false);
  };

  const renderClockingItem = ({ item }: { item: Clocking }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordDate}>{item.Date}</Text>
        <View style={styles.hoursBadge}>
          <Text style={styles.hoursText}>{parseFloat(item.HoursWorked as string || '0').toFixed(2)} hrs</Text>
        </View>
      </View>
      <View style={styles.recordDetails}>
        <View style={styles.timeRow}>
          <View style={styles.timeItem}>
            <MaterialCommunityIcons name="login" size={16} color="#4CAF50" />
            <Text style={styles.timeLabel}>In:</Text>
            <Text style={styles.timeValue}>{item.ClockIn || '--:--'}</Text>
          </View>
          <View style={styles.timeItem}>
            <MaterialCommunityIcons name="logout" size={16} color="#F44336" />
            <Text style={styles.timeLabel}>Out:</Text>
            <Text style={styles.timeValue}>{item.ClockOut || '--:--'}</Text>
          </View>
        </View>
        {parseFloat(item.BreakMins as string || '0') > 0 && (
          <View style={styles.breakRow}>
            <MaterialCommunityIcons name="coffee" size={16} color="#FF9800" />
            <Text style={styles.breakLabel}>Break:</Text>
            <Text style={styles.breakValue}>{item.BreakMins} mins</Text>
          </View>
        )}
        <View style={styles.dayTotalRow}>
          <Text style={styles.dayTotalLabel}>Day Total:</Text>
          <Text style={styles.dayTotalValue}>${item.DayTotal || '0.00'}</Text>
        </View>
      </View>
    </View>
  );

  const renderDrawerItem = ({ item }: { item: DrawerMoney }) => (
    <View style={styles.drawerCard}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerDate}>{item.Date}</Text>
        <Text style={styles.drawerAmount}>${item.DrawerAmount}</Text>
      </View>
      {item.Notes ? (
        <Text style={styles.drawerNotes}>{item.Notes}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.workerName}>{workerId === 'me' ? (user.name || 'You') : `Worker ${workerId}`}</Text>
          <Text style={styles.workerDesignation}>{user.workerProfile?.designation || 'Worker'}</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={styles.editButton} onPress={() => setIsEditing(!isEditing)}>
            <MaterialCommunityIcons name={isEditing ? 'check' : 'pencil'} size={24} color="#00af5bff" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
        <View style={styles.analyticsContainer}>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="clock-outline" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>{totalHours.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Total Hours</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="cash" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>${totalPay.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total Pay</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="calendar-check" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>{attendanceRate}%</Text>
            <Text style={styles.statLabel}>Attendance</Text>
          </View>
        </View>

        <View style={styles.pickerContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthPicker}>
            {months.map((month, index) => (
              <TouchableOpacity
                key={month}
                style={[styles.pickerButton, selectedMonth === index && styles.pickerButtonActive]}
                onPress={() => setSelectedMonth(index)}
              >
                <Text
                  style={[styles.pickerButtonText, selectedMonth === index && styles.pickerButtonTextActive]}
                >
                  {month}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.yearPicker}>
            {years.map((year) => (
              <TouchableOpacity
                key={year}
                style={[styles.pickerButton, selectedYear === year && styles.pickerButtonActive]}
                onPress={() => setSelectedYear(year)}
              >
                <Text
                  style={[styles.pickerButtonText, selectedYear === year && styles.pickerButtonTextActive]}
                >
                  {year}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pay Details</Text>
          <View style={styles.payCard}>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Pay Per Hour:</Text>
              {isEditing && isAdmin ? (
                <TextInput
                  style={styles.payInput}
                  value={payPerHour}
                  onChangeText={setPayPerHour}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={styles.payValue}>${payPerHour}/hr</Text>
              )}
            </View>
            {isEditing && isAdmin && (
              <TouchableOpacity style={styles.savePayButton} onPress={handleSavePayRate}>
                <Text style={styles.savePayButtonText}>Save</Text>
              </TouchableOpacity>
            )}
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Hours This Month:</Text>
              <Text style={styles.payValue}>{totalHours.toFixed(2)} hrs</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Monthly Total:</Text>
              <Text style={styles.payTotal}>${totalPay.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance History</Text>
          <FlatList
            data={clockings}
            renderItem={renderClockingItem}
            keyExtractor={(item, index) => index.toString()}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No attendance records for selected month</Text>
              </View>
            }
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drawer Money</Text>
          <FlatList
            data={drawerMoney}
            renderItem={renderDrawerItem}
            keyExtractor={(item, index) => index.toString()}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No drawer money records</Text>
              </View>
            }
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Analytics</Text>
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Hours Worked by Day</Text>
            {chartData.datasets[0].data.length > 0 ? (
              <BarChart
                data={chartData}
                width={screenWidth - 64}
                height={220}
                yAxisLabel=""
                yAxisSuffix="h"
                chartConfig={{
                  backgroundColor: '#fff',
                  backgroundGradientFrom: '#fff',
                  backgroundGradientTo: '#fff',
                  decimalPlaces: 1,
                  color: (opacity = 1) => `rgba(0, 175, 91, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(51, 51, 51, ${opacity})`,
                  style: { borderRadius: 16 },
                  propsForDots: { r: '4', strokeWidth: '2', stroke: '#00af5bff' },
                }}
                style={{ borderRadius: 16 }}
              />
            ) : (
              <View style={styles.emptyChart}>
                <Text style={styles.emptyText}>No data to display</Text>
              </View>
            )}
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Avg Hours/Day</Text>
              <Text style={styles.statGridValue}>{avgHoursPerDay.toFixed(1)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Hours</Text>
              <Text style={styles.statGridValue}>{totalHours.toFixed(1)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Pay</Text>
              <Text style={styles.statGridValue}>${totalPay.toFixed(2)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Break</Text>
              <Text style={styles.statGridValue}>{totalBreakTime}m</Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    marginRight: 16,
  },
  headerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  workerDesignation: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  editButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  analyticsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 6,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  pickerContainer: {
    marginBottom: 16,
  },
  monthPicker: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  yearPicker: {
    flexDirection: 'row',
  },
  pickerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  pickerButtonActive: {
    backgroundColor: '#00af5bff',
    borderColor: '#00af5bff',
  },
  pickerButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  pickerButtonTextActive: {
    color: '#fff',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  payCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  payLabel: {
    fontSize: 14,
    color: '#666',
  },
  payInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 6,
    width: 80,
    textAlign: 'right',
  },
  payValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  payTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  savePayButton: {
    backgroundColor: '#00af5bff',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  savePayButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  recordCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  recordDate: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  hoursBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hoursText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
  },
  recordDetails: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timeItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
    marginRight: 4,
  },
  timeValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
    marginRight: 4,
  },
  breakValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9800',
  },
  dayTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayTotalLabel: {
    fontSize: 14,
    color: '#666',
  },
  dayTotalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  drawerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  drawerDate: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  drawerAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  drawerNotes: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },
  chartContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  emptyChart: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statGridCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statGridLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  statGridValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 6,
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
});
