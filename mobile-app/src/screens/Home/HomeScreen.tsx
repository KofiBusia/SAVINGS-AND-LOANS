import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { API_V1 } from '../../config/api';

interface AccountSummary {
  savingsBalance: number;
  loanBalance: number;
  nextRepaymentAmount?: number;
  nextRepaymentDate?: string;
  recentTransactions: Transaction[];
}

interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  date: string;
}

const QUICK_ACTIONS = [
  { icon: '💰', label: 'Deposit' },
  { icon: '📤', label: 'Withdraw' },
  { icon: '🏦', label: 'Apply Loan' },
  { icon: '📊', label: 'Statement' },
];

export function HomeScreen() {
  const { user, token } = useSelector((s: RootState) => s.auth);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_V1}/customers/me/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSummary(await res.json());
    } catch {
      // offline — show cached data or empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchSummary(); };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerBg}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.name}>{user?.name ?? 'Customer'}</Text>
          <Text style={styles.accountNo}>Account: {user?.accountNumber ?? '—'}</Text>
        </View>

        {/* Balance Cards */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={GREEN} />
          </View>
        ) : (
          <View style={styles.cardsRow}>
            <BalanceCard
              label="Savings Balance"
              amount={summary?.savingsBalance ?? 0}
              color={GREEN}
              icon="🪙"
            />
            <BalanceCard
              label="Loan Balance"
              amount={summary?.loanBalance ?? 0}
              color="#b91c1c"
              icon="📋"
            />
          </View>
        )}

        {/* Next Repayment */}
        {summary?.nextRepaymentDate && (
          <View style={styles.repaymentBanner}>
            <Text style={styles.repaymentIcon}>📅</Text>
            <View>
              <Text style={styles.repaymentLabel}>Next repayment due</Text>
              <Text style={styles.repaymentValue}>
                GHS {summary.nextRepaymentAmount?.toLocaleString()} · {summary.nextRepaymentDate}
              </Text>
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map((a) => (
              <TouchableOpacity key={a.label} style={styles.actionBtn} activeOpacity={0.7}>
                <Text style={styles.actionIcon}>{a.icon}</Text>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recent Transactions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          {(summary?.recentTransactions ?? []).length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          ) : (
            summary!.recentTransactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BalanceCard({ label, amount, color, icon }: { label: string; amount: number; color: string; icon: string }) {
  return (
    <View style={[styles.balanceCard, { borderLeftColor: color }]}>
      <Text style={styles.balanceIcon}>{icon}</Text>
      <Text style={styles.balanceLabel}>{label}</Text>
      <Text style={[styles.balanceAmount, { color }]}>GHS {amount.toLocaleString()}</Text>
    </View>
  );
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const isCredit = tx.type === 'credit';
  return (
    <View style={styles.txRow}>
      <View style={[styles.txDot, { backgroundColor: isCredit ? '#dcfce7' : '#fee2e2' }]}>
        <Text style={{ fontSize: 16 }}>{isCredit ? '⬆️' : '⬇️'}</Text>
      </View>
      <View style={styles.txMeta}>
        <Text style={styles.txDesc}>{tx.description}</Text>
        <Text style={styles.txDate}>{tx.date}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isCredit ? '#16a34a' : '#dc2626' }]}>
        {isCredit ? '+' : '-'} GHS {tx.amount.toLocaleString()}
      </Text>
    </View>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  headerBg: {
    backgroundColor: GREEN, paddingHorizontal: 24,
    paddingTop: 20, paddingBottom: 32,
  },
  greeting: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  name: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 2 },
  accountNo: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  loadingBox: { height: 100, justifyContent: 'center', alignItems: 'center' },
  cardsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: -20 },
  balanceCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderLeftWidth: 4, elevation: 4, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
  },
  balanceIcon: { fontSize: 22, marginBottom: 6 },
  balanceLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  balanceAmount: { fontSize: 20, fontWeight: '800' },
  repaymentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 16, backgroundColor: '#fff7ed', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#fed7aa',
  },
  repaymentIcon: { fontSize: 24 },
  repaymentLabel: { fontSize: 12, color: '#92400e' },
  repaymentValue: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 12 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: {
    width: '22%', aspectRatio: 1, backgroundColor: '#fff',
    borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  actionIcon: { fontSize: 26 },
  actionLabel: { fontSize: 11, color: '#374151', marginTop: 4, fontWeight: '600' },
  emptyBox: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyText: { color: '#aaa', fontSize: 14 },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8,
  },
  txDot: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txMeta: { flex: 1 },
  txDesc: { fontSize: 14, fontWeight: '600', color: '#111' },
  txDate: { fontSize: 12, color: '#888', marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '700' },
});
