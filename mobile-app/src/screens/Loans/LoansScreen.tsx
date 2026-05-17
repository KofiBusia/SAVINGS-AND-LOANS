import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { API_V1 } from '../../config/api';
import type { StackNavigationProp } from '@react-navigation/stack';

interface LoanAccount {
  loanId: string;
  productName: string;
  principalAmount: number;
  outstandingBalance: number;
  nextRepaymentDate: string;
  nextRepaymentAmount: number;
  status: 'ACTIVE' | 'FULLY_PAID' | 'IN_ARREARS' | 'APPROVED' | 'PENDING';
  disbursedDate?: string;
  interestRate: number;
  tenureMonths: number;
}

type Props = { navigation: StackNavigationProp<any> };

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: '#dcfce7', text: '#15803d' },
  FULLY_PAID: { bg: '#f0fdf4', text: '#166534' },
  IN_ARREARS: { bg: '#fee2e2', text: '#b91c1c' },
  APPROVED: { bg: '#dbeafe', text: '#1d4ed8' },
  PENDING: { bg: '#fef9c3', text: '#854d0e' },
};

export function LoansScreen({ navigation }: Props) {
  const { token } = useSelector((s: RootState) => s.auth);
  const [loans, setLoans] = useState<LoanAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLoans = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_V1}/loans/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setLoans(await res.json());
    } catch {
      // offline — show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchLoans(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchLoans(); };

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
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Loans</Text>
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => navigation.navigate('LoanApplication')}
            activeOpacity={0.8}
          >
            <Text style={styles.applyBtnText}>+ Apply</Text>
          </TouchableOpacity>
        </View>

        {loans.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyTitle}>No active loans</Text>
            <Text style={styles.emptyDesc}>Apply for a loan to get started.</Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => navigation.navigate('LoanApplication')}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyBtnText}>Apply for a Loan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          loans.map((loan) => {
            const statusStyle = STATUS_COLORS[loan.status] ?? { bg: '#f3f4f6', text: '#374151' };
            return (
              <View key={loan.loanId} style={styles.loanCard}>
                <View style={styles.loanCardHeader}>
                  <Text style={styles.loanProduct}>{loan.productName}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.statusText, { color: statusStyle.text }]}>{loan.status.replace('_', ' ')}</Text>
                  </View>
                </View>
                <Text style={styles.loanId}>{loan.loanId}</Text>

                <View style={styles.loanAmounts}>
                  <View>
                    <Text style={styles.amtLabel}>Principal</Text>
                    <Text style={styles.amtValue}>GHS {loan.principalAmount.toLocaleString()}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.amtLabel}>Outstanding</Text>
                    <Text style={[styles.amtValue, { color: '#b91c1c' }]}>GHS {loan.outstandingBalance.toLocaleString()}</Text>
                  </View>
                </View>

                {loan.status === 'ACTIVE' && (
                  <View style={styles.repaymentRow}>
                    <Text style={styles.repayLabel}>Next payment: {loan.nextRepaymentDate}</Text>
                    <Text style={styles.repayAmt}>GHS {loan.nextRepaymentAmount.toLocaleString()}</Text>
                  </View>
                )}

                <View style={styles.loanMeta}>
                  <Text style={styles.metaText}>{loan.interestRate}% p.a. · {loan.tenureMonths} months</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, paddingBottom: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#111' },
  applyBtn: { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  applyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  emptyBox: { margin: 20, backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 6 },
  emptyDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  emptyBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  loanCard: {
    margin: 16, marginBottom: 0, backgroundColor: '#fff',
    borderRadius: 16, padding: 18,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  loanCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  loanProduct: { fontSize: 16, fontWeight: '700', color: '#111' },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  loanId: { fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 12 },
  loanAmounts: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  amtLabel: { fontSize: 11, color: '#888', marginBottom: 3 },
  amtValue: { fontSize: 18, fontWeight: '800', color: '#111' },
  repaymentRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#fff7ed', borderRadius: 10, padding: 10, marginBottom: 10,
  },
  repayLabel: { fontSize: 12, color: '#92400e' },
  repayAmt: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  loanMeta: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 10 },
  metaText: { fontSize: 12, color: '#888' },
});
