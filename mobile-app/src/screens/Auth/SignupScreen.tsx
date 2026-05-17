import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { API_V1 } from '../../config/api';
import type { StackNavigationProp } from '@react-navigation/stack';

type Step = 'identity' | 'credentials' | 'done';

type Props = { navigation: StackNavigationProp<any> };

export function SignupScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>('identity');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // identity fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ghanaCard, setGhanaCard] = useState('');
  const [phone, setPhone] = useState('');

  // credentials
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const validateIdentity = () => {
    if (!firstName.trim() || !lastName.trim()) return 'Enter your full name.';
    const cardPattern = /^GHA-\d{9}-\d$/;
    if (!cardPattern.test(ghanaCard.trim().toUpperCase())) return 'Invalid Ghana Card format (GHA-000000000-0).';
    if (phone.replace(/\D/g, '').length < 10) return 'Enter a valid 10-digit phone number.';
    return null;
  };

  const validateCredentials = () => {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirm) return 'Passwords do not match.';
    return null;
  };

  const handleNextStep = () => {
    setError('');
    const err = validateIdentity();
    if (err) { setError(err); return; }
    setStep('credentials');
  };

  const handleRegister = async () => {
    setError('');
    const err = validateCredentials();
    if (err) { setError(err); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_V1}/auth/customer/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          ghana_card_number: ghanaCard.trim().toUpperCase(),
          phone_number: phone.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Registration failed. Please try again.');
        return;
      }
      setStep('done');
    } catch {
      setError('Unable to connect. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <View style={styles.doneContainer}>
        <Text style={styles.doneEmoji}>✅</Text>
        <Text style={styles.doneTitle}>Account Created!</Text>
        <Text style={styles.doneSubtitle}>
          Your account is pending KYC verification. Visit any branch with your Ghana Card to complete activation.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => step === 'credentials' ? setStep('identity') : navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>{step === 'identity' ? 'Step 1 of 2' : 'Step 2 of 2'}</Text>
        </View>

        <Text style={styles.heading}>
          {step === 'identity' ? 'Your Identity' : 'Set a Password'}
        </Text>
        <Text style={styles.subheading}>
          {step === 'identity'
            ? 'We need your details to open your account.'
            : 'Choose a strong password for your account.'}
        </Text>

        <View style={styles.card}>
          {step === 'identity' && (
            <>
              <Field label="First Name" value={firstName} onChangeText={setFirstName} placeholder="Kofi" />
              <Field label="Last Name" value={lastName} onChangeText={setLastName} placeholder="Mensah" />
              <Field
                label="Ghana Card Number"
                value={ghanaCard}
                onChangeText={(v) => setGhanaCard(v.toUpperCase())}
                placeholder="GHA-000000000-0"
                autoCapitalize="characters"
              />
              <Field
                label="Phone Number"
                value={phone}
                onChangeText={setPhone}
                placeholder="024 000 0000"
                keyboardType="phone-pad"
              />
            </>
          )}

          {step === 'credentials' && (
            <>
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Min. 8 characters"
                secureTextEntry
              />
              <Field
                label="Confirm Password"
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Repeat password"
                secureTextEntry
              />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={step === 'identity' ? handleNextStep : handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>{step === 'identity' ? 'Continue' : 'Create Account'}</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={styles.regulated}>
          By creating an account you agree to our Terms of Service and acknowledge our Privacy Policy (Data Protection Act 843).
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label, value, onChangeText, placeholder, secureTextEntry, keyboardType, autoCapitalize,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: 'phone-pad' | 'email-address' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#aaa"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'words'}
      />
    </View>
  );
}

const GREEN = '#006B3F';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flexGrow: 1, padding: 24 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, marginTop: 8 },
  back: { fontSize: 15, color: GREEN, fontWeight: '600' },
  stepLabel: { fontSize: 12, color: '#888' },
  heading: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 6 },
  subheading: { fontSize: 14, color: '#666', marginBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111' },
  error: { fontSize: 13, color: '#dc2626', backgroundColor: '#fef2f2', borderRadius: 8, padding: 10, marginBottom: 4 },
  button: { marginTop: 8, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  regulated: { textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 24, lineHeight: 16 },
  doneContainer: { flex: 1, backgroundColor: '#f8fafc', padding: 32, justifyContent: 'center', alignItems: 'center' },
  doneEmoji: { fontSize: 64, marginBottom: 20 },
  doneTitle: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 12 },
  doneSubtitle: { fontSize: 15, color: '#555', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
});
