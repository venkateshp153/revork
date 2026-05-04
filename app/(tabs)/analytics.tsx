import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { BarChart, LineChart, PieChart } from 'react-native-chart-kit';

const screenWidth = Dimensions.get('window').width;

interface Clocking {
  WorkerID: string;
  Name: string;
  Date: string;
  HoursWorked: string;
}

interface Worker {
  WorkerID: string;
  Name: string;
  PayPerHour: string;
}

export default function AnalyticsDashboardScreen() {
  const [filterType, setFilterType] = useState<'week' | 'month' | 'custom'>('month');
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  const user = useSelector((state: RootState) => state.user);
  const isAdmin = user.profile?.designation === 'admin';
  const isManager = user.profile?.designation === 'manager';
  const isWorker = user.designation === 'worker' || user.workerProfile?.designation === 'worker';

  const workers: Worker[] = [];
  const clockings: Clocking[] = [];

  const dateRange = useMemo(() => {
    const now = new Date();
    let start = new Date();

    if (filterType === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(now.setDate(diff));
    } else if (filterType === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (customRange) {
      start = new Date(customRange.start);
    }

    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }, [filterType, customRange]);

  const filteredClockings = useMemo(() => {
    return clockings.filter((c) => c.Date >= dateRange.start && c.Date <= dateRange.end);
  }, [clockings, dateRange]);

  const totalPayrollThisMonth = useMemo(() => {
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

  const totalHoursThisMonth = useMemo(() => {
    return filteredClockings.reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
  }, [filteredClockings]);

  const activeWorkersToday = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayClockings = clockings.filter((c) => c.Date === today);
    return todayClockings.filter((c) => c.HoursWorked && parseFloat(c.HoursWorked) > 0).length;
  }, [clockings]);

  const avgHoursPerWorker = useMemo(() => {
    const workerHours: Record<string, number> = {};
    filteredClockings.forEach((c) => {
      workerHours[c.WorkerID] = (workerHours[c.WorkerID] || 0) + parseFloat(c.HoursWorked as string || '0');
    });
    const workerIds = Object.keys(workerHours);
    return workerIds.length > 0 ? totalHoursThisMonth / workerIds.length : 0;
  }, [filteredClockings, totalHoursThisMonth]);

  const dailyHoursData = useMemo(() => {
    const daysData: Record<string, number> = {};
    const { start, end } = dateRange;
    
    let currentDate = new Date(start);
    const endDate = new Date(end);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      daysData[dateStr] = 0;
      currentDate.setDate(currentDate.getDate() + 1);
    }

    filteredClockings.forEach((c) => {
      if (daysData[c.Date] !== undefined) {
        daysData[c.Date] += parseFloat(c.HoursWorked as string || '0');
      }
    });

    const labels = Object.keys(daysData).map((d) => {
      const date = new Date(d);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    return {
      labels,
      datasets: [{ data: Object.values(daysData) }],
    };
  }, [filteredClockings, dateRange]);

  const workerHoursData = useMemo(() => {
    const workerHours: Record<string, { name: string; hours: number }> = {};
    
    filteredClockings.forEach((c) => {
      if (!workerHours[c.WorkerID]) {
        workerHours[c.WorkerID] = { name: c.Name, hours: 0 };
      }
      workerHours[c.WorkerID].hours += parseFloat(c.HoursWorked as string || '0');
    });

    const workerIds = Object.keys(workerHours).slice(0, 6);
    const labels = workerIds.map((id) => {
      const parts = workerHours[id].name.split(' ');
      return `${parts[0]?.charAt(0)}${parts[1]?.charAt(0) || ''}`;
    });

    return {
      labels,
      datasets: [{ data: workerIds.map((id) => workerHours[id].hours) }],
    };
  }, [filteredClockings]);

  const pieChartData = useMemo(() => {
    const workerHours: Record<string, { name: string; hours: number }> = {};
    
    filteredClockings.forEach((c) => {
      if (!workerHours[c.WorkerID]) {
        workerHours[c.WorkerID] = { name: c.Name, hours: 0 };
      }
      workerHours[c.WorkerID].hours += parseFloat(c.HoursWorked as string || '0');
    });

    return Object.values(workerHours).map((w, index) => ({
      name: w.name,
      population: w.hours,
      color: `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.8)`,
      legend: w.name,
    }));
  }, [filteredClockings]);

  const workerTodayData = useMemo(() => {
    if (!isWorker) return null;
    
    const currentWorkerId = user.workerProfile?.workerId;
    const today = new Date().toISOString().split('T')[0];
    const todayClocking = clockings.find((c) => c.WorkerID === currentWorkerId && c.Date === today);
    
    const hoursWorked = todayClocking ? parseFloat(todayClocking.HoursWorked as string || '0') : 0;
    const payPerHour = user.workerProfile?.payPerHour || 0;
    const payEarned = Math.round((hoursWorked * payPerHour) * 100) / 100;
    
    return { hoursWorked, payEarned };
  }, [clockings, user.workerProfile, isWorker]);

  const workerMonthlyData = useMemo(() => {
    if (!isWorker) return null;
    
    const currentWorkerId = user.workerProfile?.workerId;
    const currentMonth = new Date().getMonth();
    
    const monthClockings = clockings.filter((c) => {
      const date = new Date(c.Date);
      return c.WorkerID === currentWorkerId && date.getMonth() === currentMonth;
    });
    
    const totalHours = monthClockings.reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
    const payPerHour = user.workerProfile?.payPerHour || 0;
    const totalPay = Math.round((totalHours * payPerHour) * 100) / 100;
    
    const daysData: Record<number, number> = {};
    monthClockings.forEach((c) => {
      const day = new Date(c.Date).getDate();
      daysData[day] = (daysData[day] || 0) + parseFloat(c.HoursWorked as string || '0');
    });
    
    const last28Days = Array.from({ length: 28 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (27 - i));
      return date;
    });
    
    const trendData = last28Days.map((date) => {
      const day = date.getDate();
      return daysData[day] || 0;
    });
    
    return {
      totalHours,
      totalPay,
      trendData: {
        labels: last28Days.map((d) => `${d.getMonth() + 1}/${d.getDate()}`),
        datasets: [{ data: trendData }],
      },
      barData: {
        labels: Object.keys(daysData).map(String),
        datasets: [{ data: Object.values(daysData) }],
      },
    };
  }, [clockings, user.workerProfile, isWorker]);

  if (isWorker) {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>My Analytics</Text>
        </View>

        <View style={styles.payCard}>
          <Text style={styles.payLabel}>Monthly Pay Earned</Text>
          <Text style={styles.payValue}>${workerMonthlyData?.totalPay.toFixed(2) || '0.00'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hours Breakdown</Text>
          {workerMonthlyData?.barData && workerMonthlyData.barData.datasets[0].data.length > 0 ? (
            <BarChart
              data={workerMonthlyData.barData}
              width={screenWidth - 48}
              height={200}
              yAxisLabel=""
              yAxisSuffix="h"
              chartConfig={{
                backgroundColor: '#fff',
                backgroundGradientFrom: '#fff',
                backgroundGradientTo: '#fff',
                decimalPlaces: 1,
                color: (opacity = 1) => `rgba(0, 175, 91, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(51, 51, 51, ${opacity})`,
              }}
              style={{ borderRadius: 12 }}
            />
          ) : (
            <View style={styles.emptyChart}>
              <Text style={styles.emptyText}>No data for this month</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>28-Day Trend</Text>
          {workerMonthlyData?.trendData && workerMonthlyData.trendData.datasets[0].data.some((v) => v > 0) ? (
            <LineChart
              data={workerMonthlyData.trendData}
              width={screenWidth - 48}
              height={200}
              yAxisLabel=""
              chartConfig={{
                backgroundColor: '#fff',
                backgroundGradientFrom: '#fff',
                backgroundGradientTo: '#fff',
                decimalPlaces: 1,
                color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(51, 51, 51, ${opacity})`,
              }}
              style={{ borderRadius: 12 }}
            />
          ) : (
            <View style={styles.emptyChart}>
              <Text style={styles.emptyText}>No trend data available</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance Rate</Text>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '75%' }]} />
            </View>
            <Text style={styles.progressText}>75%</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Analytics Dashboard</Text>
      </View>

      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'week' && styles.filterButtonActive]}
          onPress={() => setFilterType('week')}
        >
          <Text style={[styles.filterText, filterType === 'week' && styles.filterTextActive]}>Week</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'month' && styles.filterButtonActive]}
          onPress={() => setFilterType('month')}
        >
          <Text style={[styles.filterText, filterType === 'month' && styles.filterTextActive]}>Month</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'custom' && styles.filterButtonActive]}
          onPress={() => setFilterType('custom')}
        >
          <Text style={[styles.filterText, filterType === 'custom' && styles.filterTextActive]}>Custom</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="cash" size={28} color="#4CAF50" />
          <Text style={styles.summaryValue}>${totalPayrollThisMonth.toFixed(0)}</Text>
          <Text style={styles.summaryLabel}>Total Payroll (Month)</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="timer" size={28} color="#2196F3" />
          <Text style={styles.summaryValue}>{totalHoursThisMonth.toFixed(1)}</Text>
          <Text style={styles.summaryLabel}>Total Hours</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="account-check" size={28} color="#FF9800" />
          <Text style={styles.summaryValue}>{activeWorkersToday}</Text>
          <Text style={styles.summaryLabel}>Active Today</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="clock-outline" size={28} color="#9C27B0" />
          <Text style={styles.summaryValue}>{avgHoursPerWorker.toFixed(1)}</Text>
          <Text style={styles.summaryLabel}>Avg Hours/Worker</Text>
        </View>
      </ScrollView>

        <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily Hours Trend</Text>
        {dailyHoursData.datasets[0].data.some((v) => v > 0) ? (
          <LineChart
            data={dailyHoursData}
            width={screenWidth - 48}
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
            }}
            style={{ borderRadius: 12 }}
          />
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyText}>No data for selected period</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Worker Hours Comparison</Text>
        {workerHoursData.datasets[0].data.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <BarChart
              data={workerHoursData}
              width={Math.max(screenWidth - 48, workerHoursData.labels.length * 60)}
              height={220}
              yAxisSuffix="h"
              yAxisLabel=""
              chartConfig={{
                backgroundColor: '#fff',
                backgroundGradientFrom: '#fff',
                backgroundGradientTo: '#fff',
                decimalPlaces: 1,
                color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(51, 51, 51, ${opacity})`,
              }}
              style={{ borderRadius: 12 }}
            />
          </ScrollView>
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyText}>No worker data available</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hours Distribution</Text>
        {pieChartData.length > 0 ? (
          <PieChart
            data={pieChartData}
            width={screenWidth - 48}
            height={220}
            chartConfig={{
              backgroundColor: '#fff',
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(51, 51, 51, ${opacity})`,
            }}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            absolute
          />
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyText}>No distribution data available</Text>
          </View>
        )}
      </View>
    </ScrollView>
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
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  filterBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    marginTop: 8,
    marginBottom: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#00af5bff',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  summaryScroll: {
    flexDirection: 'row',
    paddingHorizontal: 16,
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
    fontSize: 22,
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
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  payCard: {
    backgroundColor: '#00af5bff',
    margin: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  payLabel: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  payValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
  },
  emptyChart: {
    height: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  progressBar: {
    flex: 1,
    height: 12,
    backgroundColor: '#e0e0e0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00af5bff',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 12,
    width: 50,
  },
});
