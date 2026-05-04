import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { logout } from '@/redux/store/userSlice';
import { useRouter } from 'expo-router';
import { signOutUser } from '@/assets/services/firebaseService';

export default function ProfileScreen() {
  const dispatch = useDispatch();
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await signOutUser();
            dispatch(logout());
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleGenerateJoinLink = () => {
    if (user.profile?.designation !== 'admin') {
      Alert.alert('Access Denied', 'Only admins can generate join links.');
      return;
    }
    
    Alert.alert(
      'Generate Join Link',
      'Share this link with workers to join your organization:',
      [
        { text: 'Copy Link', onPress: () => Alert.alert('Copied!', 'Link copied to clipboard') },
        { text: 'Share via SMS' },
        { text: 'Share via Email' },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const menuItems = [
    { icon: 'account', label: 'Personal Info', action: () => {} },
    { icon: 'security', label: 'Security', action: () => {} },
    { icon: 'bell', label: 'Notification Settings', action: () => {} },
    { icon: 'help-circle', label: 'Help & Support', action: () => {} },
    { icon: 'information', label: 'About', action: () => {} },
  ];

  if (user.profile?.designation === 'admin') {
    menuItems.unshift({
      icon: 'link-variant',
      label: 'Generate Join Link',
      action: handleGenerateJoinLink,
    });
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {user.name?.charAt(0).toUpperCase() || 'U'}
          </Text>
        </View>
        <Text style={styles.userName}>{user.name || 'User'}</Text>
        <Text style={styles.userEmail}>{user.email || 'email@example.com'}</Text>
        <View style={styles.designationBadge}>
          <Text style={styles.designationText}>
            {user.profile?.designation?.toUpperCase() || 'USER'}
          </Text>
        </View>
      </View>

      <View style={styles.companyInfoContainer}>
        <Text style={styles.sectionTitle}>Company Information</Text>
        <View style={styles.companyInfo}>
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="office-building" size={20} color="#00af5bff" />
            <Text style={styles.infoLabel}>Company:</Text>
            <Text style={styles.infoValue}>{user.profile?.companyName || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="phone" size={20} color="#00af5bff" />
            <Text style={styles.infoLabel}>Phone:</Text>
            <Text style={styles.infoValue}>{user.profile?.companyPhone || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="email" size={20} color="#00af5bff" />
            <Text style={styles.infoLabel}>Email:</Text>
            <Text style={styles.infoValue}>{user.profile?.companyEmail || 'N/A'}</Text>
          </View>
          {user.profile?.companyAddress && (
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="map-marker" size={20} color="#00af5bff" />
              <Text style={styles.infoLabel}>Address:</Text>
              <Text style={styles.infoValue}>{user.profile.companyAddress}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.menuContainer}>
        <Text style={styles.sectionTitle}>Settings</Text>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuItem}
            onPress={item.action}
          >
            <View style={styles.menuItemLeft}>
              <MaterialCommunityIcons name={item.icon as any} size={24} color="#333" />
              <Text style={styles.menuItemLabel}>{item.label}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#999" />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={24} color="#F44336" />
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Revork v1.0.0</Text>
        <Text style={styles.footerText}>© 2024 Revork. All rights reserved.</Text>
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
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#00af5bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  designationBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  designationText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  companyInfoContainer: {
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  companyInfo: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginLeft: 8,
    marginRight: 4,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  menuContainer: {
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 16,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemLabel: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
  },
  logoutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffebee',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F44336',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F44336',
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    padding: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
});
