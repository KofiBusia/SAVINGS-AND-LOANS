import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useDispatch } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import { setCredentials } from '../../store/authSlice';
import { API_V1 } from '../../config/api';
import type { StackNavigationProp } from '@react-navigation/stack';

type Props = { navigation: StackNavigationProp<any> };

export function LoginScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!phone.trim() || !password) {
      setError('Please enter your phone number and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_V1}/auth/customer/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Login failed. Check your credentials.');
        return;
      }
      await SecureStore.setItemAsync('gsl_token', data.access_token);
      await SecureStore.setItemAsync('gsl_refresh', data.refresh_token ?? '');
      await SecureStore.setItemAsync('gsl_user', JSON.stringify(data.customer));
      dispatch(setCredentials({
        token: data.access_token,
        refreshToken: data.refresh_token ?? '',
        user: data.customer,
      }));
    } catch {
      setError('Unable to connect. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>🏦</Text>
          </View>
          <Text style={styles.title}>Ghana Savings &amp; Loans</Text>
          <Text style={styles.subtitle}>Welcome back</Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 024 000 0000"
            placeholderTextColor="#aaa"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            autoComplete="tel"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#aaa"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Sign In</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.link}
            onPress={() => Alert.alert('Reset Password', 'Please visit your nearest branch or call 0800-GSL-HELP.')}
          >
            <Text style={styles.linkText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        {/* Sign up */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don&apos;t have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
            <Text style={styles.footerLink}>Create one</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.regulated}>Regulated by Bank of Ghana</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 32 },
  logoBox: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  logoEmoji: { fontSize: 36 },
  title: { fontSize: 22, fontWeight: '800', color: '#111', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 20,
    padding: 24, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06,
    shadowRadius: 8, elevation: 3,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111',
  },
  error: {
    marginTop: 12, fontSize: 13, color: '#dc2626',
    backgroundColor: '#fef2f2', borderRadius: 8,
    padding: 10, overflow: 'hidden',
  },
  button: {
    marginTop: 20, backgroundColor: GREEN, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 14 },
  linkText: { fontSize: 13, color: GREEN, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  footerText: { fontSize: 14, color: '#666' },
  footerLink: { fontSize: 14, color: GREEN, fontWeight: '700' },
  regulated: { textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 24 },
});
