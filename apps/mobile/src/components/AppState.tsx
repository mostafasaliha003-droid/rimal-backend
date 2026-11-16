import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SearchCriteria } from '../types';

type State = { criteria: SearchCriteria | null; destinationName: string; setSearch: (criteria: SearchCriteria, name: string) => void; saved: number[]; savedReady: boolean; savedError: boolean; toggleSaved: (hid: number) => void };
const Context = createContext<State | null>(null);
const SAVED_KEY = 'remal.savedHotelIds.v1';
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null); const [destinationName, setDestinationName] = useState('');
  const [saved, setSaved] = useState<number[]>([]); const [savedReady, ready] = useState(false); const [savedError, fail] = useState(false);
  useEffect(() => { let active = true; AsyncStorage.getItem(SAVED_KEY).then(raw => { if (!active) return; const parsed: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) setSaved([...new Set(parsed.filter((value): value is number => Number.isSafeInteger(value) && value > 0))].slice(0, 100)); }).catch(() => { if (active) fail(true); }).finally(() => { if (active) ready(true); }); return () => { active = false; }; }, []);
  const toggleSaved = (hid: number) => { if (!savedReady || !Number.isSafeInteger(hid) || hid <= 0) return; const next = saved.includes(hid) ? saved.filter(id => id !== hid) : [...saved, hid].slice(-100); setSaved(next); void AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).then(() => fail(false)).catch(() => fail(true)); };
  return <Context.Provider value={{ criteria, destinationName, setSearch: (value, name) => { setCriteria(value); setDestinationName(name); }, saved, savedReady, savedError, toggleSaved }}>{children}</Context.Provider>;
}
export function useAppState() { const value = useContext(Context); if (!value) throw new Error('AppStateProvider missing'); return value; }
