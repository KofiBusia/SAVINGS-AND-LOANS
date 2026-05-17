import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector, useDispatch } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import { RootState } from '../../store';
import { clearCredentials } from '../../store/authSlice';

const MENU_ITEMS = [
  { icon: '👤', label: 'Personal Information', desc: 'Name, phone, address' },
  { icon: '🔔', label: 'Notifications', desc: 'Alerts and reminders' },
  { icon: '🔒', label: 'Security', desc: 'Password, biometrics, 2FA' },
  { icon: '📄', label: 'Documents', desc: 'Statements and certificates' },
  { icon: '🌍', label: 'Language', desc: 'English, Twi, Ga, Ewe, Hausa' },
  { icon: '❓', label: 'Help & Support', desc: 'FAQs, contact us' },
];

export function AccountScreen() {
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await SecureStore.deleteItemAsync('gsl_token');
          await SecureStore.deleteItemAsync('gsl_refresh');
          await SecureStore.deleteItemAsync('gsl_user');
          dispatch(clearCredentials());
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.name}>{user?.name ?? 'Customer'}</Text>
          <Text style={styles.phone}>{user?.phoneNumber ?? ''}</Text>
          <View style={styles.accountBadge}>
            <Text style={styles.accountBadgeText}>{user?.accountNumber ?? '—'}</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={styles.menuCard}>
          {MENU_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuRow, i < MENU_ITEMS.length - 1 && styles.menuRowBorder]}
              activeOpacity={0.6}
            >
              <View style={styles.menuIcon}>
                <Text style={{ fontSize: 20 }}>{item.icon}</Text>
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuDesc}>{item.desc}</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          Ghana Savings &amp; Loans · Regulated by Bank of Ghana{'\n'}
          Data Protection Act 843 · AML Act 1044
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  profileHeader: {
    backgroundColor: GREEN, paddingTop: 24, paddingBottom: 32,
    alignItems: 'center',
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: 36, fontWeight: '800', color: '#fff' },
  name: { fontSize: 22, fontWeight: '800', color: '#fff' },
  phone: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  accountBadge: {
    marginTop: 10, backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5,
  },
  accountBadgeText: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace' },
  menuCard: {
    margin: 16, marginTop: -16, backgroundColor: '#fff',
    borderRadius: 20, overflow: 'hidden',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  menuIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center',
  },
  menuContent: { flex: 1 },
  menuLabel: { fontSize: 15, fontWeight: '600', color: '#111' },
  menuDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  menuChevron: { fontSize: 20, color: '#ccc' },
  signOutBtn: {
    marginHorizontal: 16, marginTop: 4, paddingVertical: 14,
    backgroundColor: '#fff', borderRadius: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#fca5a5',
  },
  signOutText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  footer: { textAlign: 'center', fontSize: 11, color: '#aaa', margin: 24, lineHeight: 18 },
});
