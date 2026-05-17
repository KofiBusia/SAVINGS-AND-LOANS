import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import * as SecureStore from 'expo-secure-store';

import { RootState } from '../store';
import { setCredentials, setLoading } from '../store/authSlice';

import { LoginScreen } from '../screens/Auth/LoginScreen';
import { SignupScreen } from '../screens/Auth/SignupScreen';
import { HomeScreen } from '../screens/Home/HomeScreen';
import { LoansScreen } from '../screens/Loans/LoansScreen';
import { LoanApplicationWizard } from '../screens/Loans/LoanApplicationWizard';
import { SavingsScreen } from '../screens/Savings/SavingsScreen';
import { AccountScreen } from '../screens/Account/AccountScreen';
import { GhanaCardScanScreen } from '../screens/Onboarding/GhanaCardScanScreen';

const GREEN = '#006B3F';

// ─── Auth Stack ───────────────────────────────────────────────────────────────
const Auth = createStackNavigator();
function AuthNavigator() {
  return (
    <Auth.Navigator screenOptions={{ headerShown: false }}>
      <Auth.Screen name="Login" component={LoginScreen} />
      <Auth.Screen name="Signup" component={SignupScreen} />
      <Auth.Screen name="GhanaCardScan" component={GhanaCardScanScreen} />
    </Auth.Navigator>
  );
}

// ─── Bottom Tabs ──────────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator();
function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingBottom: 4, height: 58 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          const icons: Record<string, string> = {
            Home: '🏠', Loans: '📋', Savings: '🪙', Account: '👤',
          };
          return <Text style={{ fontSize: focused ? 22 : 20 }}>{icons[route.name]}</Text>;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Loans" component={LoansStack} />
      <Tab.Screen name="Savings" component={SavingsScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

// ─── Loans Stack (within tabs) ────────────────────────────────────────────────
const LoansNav = createStackNavigator();
function LoansStack() {
  return (
    <LoansNav.Navigator screenOptions={{ headerShown: false }}>
      <LoansNav.Screen name="LoansList" component={LoansScreen} />
      <LoansNav.Screen name="LoanApplication" component={LoanApplicationWizard} />
    </LoansNav.Navigator>
  );
}

// ─── Root Navigator ───────────────────────────────────────────────────────────
const Root = createStackNavigator();
export function RootNavigator() {
  const dispatch = useDispatch();
  const { token, isLoading } = useSelector((s: RootState) => s.auth);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const savedToken = await SecureStore.getItemAsync('gsl_token');
        const savedUser = await SecureStore.getItemAsync('gsl_user');
        const savedRefresh = await SecureStore.getItemAsync('gsl_refresh');
        if (savedToken && savedUser) {
          dispatch(setCredentials({
            token: savedToken,
            refreshToken: savedRefresh ?? '',
            user: JSON.parse(savedUser),
          }));
          return;
        }
      } catch {
        // ignore — treat as logged out
      }
      dispatch(setLoading(false));
    };
    hydrate();
  }, [dispatch]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 40, marginBottom: 20 }}>🏦</Text>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {token ? (
        <Root.Screen name="App" component={AppTabs} />
      ) : (
        <Root.Screen name="Auth" component={AuthNavigator} />
      )}
    </Root.Navigator>
  );
}
