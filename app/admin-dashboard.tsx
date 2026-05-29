import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getAllUsers, getAllWorkers, getAllCompanies } from '@/assets/services/firebaseService';

interface UserStats {
  totalUsers: number;
  totalCompanies: number;
  totalWorkers: number;
  activeToday: number;
}

export default function AdminDashboardScreen() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UserStats>({
    totalUsers: 0,
    totalCompanies: 0,
    totalWorkers: 0,
    activeToday: 0,
  });
  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'companies' | 'workers'>('overview');

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [usersData, companiesData, workersData] = await Promise.all([
        getAllUsers(),
        getAllCompanies(),
        getAllWorkers(),
      ]);

      setUsers(usersData);
      setCompanies(companiesData);
      setWorkers(workersData);

      const today = new Date().toDateString();
      const activeTodayCount = usersData.filter((user: any) => {
        const lastLogin = new Date(user.lastLoginAt);
        return lastLogin.toDateString() === today;
      }).length;

      setStats({
        totalUsers: usersData.length,
        totalCompanies: companiesData.length,
        totalWorkers: workersData.length,
        activeToday: activeTodayCount,
      });
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderOverview = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="account" size={32} color="#2196F3" />
          <Text style={styles.statValue}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="office-building" size={32} color="#4CAF50" />
          <Text style={styles.statValue}>{stats.totalCompanies}</Text>
          <Text style={styles.statLabel}>Companies</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="account-group" size={32} color="#FF9800" />
          <Text style={styles.statValue}>{stats.totalWorkers}</Text>
          <Text style={styles.statLabel}>Workers</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="account-check" size={32} color="#9C27B0" />
          <Text style={styles.statValue}>{stats.activeToday}</Text>
          <Text style={styles.statLabel}>Active Today</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Users</Text>
        {users.slice(0, 5).map((user) => (
          <View key={user.uid} style={styles.listItem}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user.name?.charAt(0)?.toUpperCase() || 'U'}
              </Text>
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>{user.name || 'Unknown'}</Text>
              <Text style={styles.itemSubtitle}>{user.email}</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{user.designation}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Companies</Text>
        {companies.slice(0, 5).map((company) => (
          <View key={company.companyId} style={styles.listItem}>
            <View style={[styles.avatar, { backgroundColor: '#4CAF50' }]}>
              <MaterialCommunityIcons name="office-building" size={20} color="#fff" />
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>{company.companyName}</Text>
              <Text style={styles.itemSubtitle}>ID: {company.companyId}</Text>
            </View>
            <Text style={styles.itemDate}>
              {new Date(company.createdAt).toLocaleDateString()}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  const renderUsersList = () => (
    <FlatList
      data={users}
      keyExtractor={(item) => item.uid}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.name?.charAt(0)?.toUpperCase() || 'U'}
            </Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle}>{item.name || 'Unknown'}</Text>
            <Text style={styles.itemSubtitle}>{item.email}</Text>
            <Text style={styles.itemMeta}>
              {item.authProvider} • {item.designation}
            </Text>
          </View>
          <View style={styles.itemDetails}>
            <Text style={styles.itemDate}>
              {new Date(item.lastLoginAt).toLocaleDateString()}
            </Text>
            <Text style={styles.loginCount}>{item.loginCount} logins</Text>
          </View>
        </View>
      )}
      contentContainerStyle={styles.listContent}
    />
  );

  const renderCompaniesList = () => (
    <FlatList
      data={companies}
      keyExtractor={(item) => item.companyId}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View style={[styles.avatar, { backgroundColor: '#4CAF50' }]}>
            <MaterialCommunityIcons name="office-building" size={20} color="#fff" />
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle}>{item.companyName}</Text>
            <Text style={styles.itemSubtitle}>Owner: {item.ownerId}</Text>
            <Text style={styles.itemMeta}>
              Workers: {item.workerCount || 0}
            </Text>
          </View>
          <View style={styles.itemDetails}>
            <Text style={styles.itemDate}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
      )}
      contentContainerStyle={styles.listContent}
    />
  );

  const renderWorkersList = () => (
    <FlatList
      data={workers}
      keyExtractor={(item) => item.workerId}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View style={[styles.avatar, { backgroundColor: '#FF9800' }]}>
            <Text style={styles.avatarText}>
              {item.name?.charAt(0)?.toUpperCase() || 'W'}
            </Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle}>{item.name}</Text>
            <Text style={styles.itemSubtitle}>{item.email}</Text>
            <Text style={styles.itemMeta}>
              {item.phone} • {item.companyId}
            </Text>
          </View>
          <View style={styles.itemDetails}>
            <Text style={styles.itemDate}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
      )}
      contentContainerStyle={styles.listContent}
    />
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00af5bff" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <TouchableOpacity onPress={fetchAllData} style={styles.refreshButton}>
          <MaterialCommunityIcons name="refresh" size={24} color="#00af5bff" />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.activeTab]}
          onPress={() => setActiveTab('overview')}
        >
          <Text style={[styles.tabText, activeTab === 'overview' && styles.activeTabText]}>
            Overview
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.activeTab]}
          onPress={() => setActiveTab('users')}
        >
          <Text style={[styles.tabText, activeTab === 'users' && styles.activeTabText]}>
            Users ({users.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'companies' && styles.activeTab]}
          onPress={() => setActiveTab('companies')}
        >
          <Text style={[styles.tabText, activeTab === 'companies' && styles.activeTabText]}>
            Companies ({companies.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'workers' && styles.activeTab]}
          onPress={() => setActiveTab('workers')}
        >
          <Text style={[styles.tabText, activeTab === 'workers' && styles.activeTabText]}>
            Workers ({workers.length})
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.content}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'users' && renderUsersList()}
        {activeTab === 'companies' && renderCompaniesList()}
        {activeTab === 'workers' && renderWorkersList()}
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    padding: 8,
  },
  tabBar: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  activeTab: {
    backgroundColor: '#00af5bff',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
  },
  content: {
    flex: 1,
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
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statCard: {
    width: '50%',
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  listContent: {
    padding: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#00af5bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  itemSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  itemMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  itemDetails: {
    alignItems: 'flex-end',
  },
  itemDate: {
    fontSize: 12,
    color: '#999',
  },
  loginCount: {
    fontSize: 11,
    color: '#00af5bff',
    marginTop: 4,
  },
  badge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00af5bff',
    textTransform: 'capitalize',
  },
});
