import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { API_V1 } from '../../config/api';

interface SavingsAccount {
  accountNumber: string;
  balance: number;
  availableBalance: number;
  productName: string;
  interestRate: number;
  openedDate: string;
  status: 'ACTIVE' | 'DORMANT' | 'CLOSED';
}

interface SavingsTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'INTEREST';
  amount: number;
  date: string;
  reference: string;
  balance: number;
}

export function SavingsScreen() {
  const { token } = useSelector((s: RootState) => s.auth);
  const [account, setAccount] = useState<SavingsAccount | null>(null);
  const [transactions, setTransactions] = useState<SavingsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [accRes, txRes] = await Promise.all([
        fetch(`${API_V1}/savings/me`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_V1}/savings/me/transactions?limit=20`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (accRes.ok) setAccount(await accRes.json());
      if (txRes.ok) setTransactions(await txRes.json());
    } catch {
      // show cached or empty
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={GREEN} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBg}>
          <Text style={styles.headerTitle}>My Savings</Text>
          {account && (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <Text style={styles.balance}>GHS {account.availableBalance.toLocaleString()}</Text>
              <Text style={styles.balanceSub}>Total: GHS {account.balance.toLocaleString()}</Text>
            </View>
          )}
        </View>

        {account && (
          <View style={styles.detailCard}>
            <Row label="Account Number" value={account.accountNumber} mono />
            <Row label="Product" value={account.productName} />
            <Row label="Interest Rate" value={`${account.interestRate}% p.a. (simple)`} />
            <Row label="Opened" value={account.openedDate} />
            <Row label="Status" value={account.status} highlight={account.status === 'ACTIVE'} />
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <ActionBtn icon="💰" label="Deposit" />
          <ActionBtn icon="📤" label="Withdraw" />
          <ActionBtn icon="📄" label="Statement" />
        </View>

        {/* Transactions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          {transactions.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          ) : (
            transactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View style={[styles.txIcon, { backgroundColor: tx.type === 'DEPOSIT' || tx.type === 'INTEREST' ? '#dcfce7' : '#fee2e2' }]}>
                  <Text style={{ fontSize: 18 }}>
                    {tx.type === 'DEPOSIT' ? '⬆️' : tx.type === 'INTEREST' ? '✨' : '⬇️'}
                  </Text>
                </View>
                <View style={styles.txMeta}>
                  <Text style={styles.txType}>{tx.type}</Text>
                  <Text style={styles.txDate}>{tx.date} · {tx.reference}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txAmount, { color: tx.type === 'WITHDRAWAL' ? '#dc2626' : '#16a34a' }]}>
                    {tx.type === 'WITHDRAWAL' ? '-' : '+'} GHS {tx.amount.toLocaleString()}
                  </Text>
                  <Text style={styles.txBalance}>Bal: GHS {tx.balance.toLocaleString()}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono, highlight && { color: GREEN, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function ActionBtn({ icon, label }: { icon: string; label: string }) {
  return (
    <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerBg: { backgroundColor: GREEN, padding: 24, paddingBottom: 32 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 16 },
  balanceBox: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16 },
  balanceLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  balance: { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4 },
  balanceSub: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
  detailCard: {
    margin: 16, marginTop: -16, backgroundColor: '#fff',
    borderRadius: 16, padding: 16,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  detailLabel: { fontSize: 13, color: '#888' },
  detailValue: { fontSize: 13, fontWeight: '600', color: '#111' },
  mono: { fontFamily: 'monospace' },
  actionsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 8 },
  actionBtn: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 12, color: '#374151', fontWeight: '600', marginTop: 4 },
  section: { paddingHorizontal: 16, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 10 },
  emptyBox: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyText: { color: '#aaa', fontSize: 14 },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8,
  },
  txIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txMeta: { flex: 1 },
  txType: { fontSize: 13, fontWeight: '600', color: '#111' },
  txDate: { fontSize: 11, color: '#aaa', marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '700' },
  txBalance: { fontSize: 11, color: '#aaa', marginTop: 2 },
});
