import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SearchCriteria } from '../types';
import { APP_ENV, authSession } from '../api';
import { useAuth } from '../auth';
import { createOfferReviewDraft, criteriaIdentity, type OfferReviewDraft, type OfferReviewInput } from './offerReviewModel';

type State = { criteria: SearchCriteria | null; destinationName: string; setSearch: (criteria: SearchCriteria, name: string) => void;
  saved: number[]; savedReady: boolean; savedError: boolean; toggleSaved: (hid: number) => void;
  reviewDraft: OfferReviewDraft | null; setReviewDraft: (input: OfferReviewInput) => boolean;
  getReviewDraft: () => OfferReviewDraft | null; clearReviewDraft: () => void };
const Context = createContext<State | null>(null);
const SAVED_KEY = 'remal.savedHotelIds.v1';
const ownerKey = () => `${APP_ENV}:${authSession.getSnapshot().status}:${authSession.getRevision()}`;
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, sessionRevision } = useAuth();
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null); const [destinationName, setDestinationName] = useState('');
  const criteriaRef = useRef<SearchCriteria | null>(null);
  const draftRef = useRef<OfferReviewDraft | null>(null);
  const [storedDraft, storeDraft] = useState<OfferReviewDraft | null>(null);
  const clearReviewDraft = useCallback(() => { draftRef.current = null; storeDraft(null); }, []);
  const getReviewDraft = useCallback(() => {
    const draft = draftRef.current;
    return draft && draft.ownerKey === ownerKey() && draft.searchKey === criteriaIdentity(criteriaRef.current) ? draft : null;
  }, []);
  const setReviewDraft = useCallback((input: OfferReviewInput) => {
    if (authSession.getSnapshot().status === 'loading' || criteriaIdentity(input.criteria) !== criteriaIdentity(criteriaRef.current)) return false;
    const draft = createOfferReviewDraft(input, ownerKey());
    if (!draft) return false;
    draftRef.current = draft; storeDraft(draft); return true;
  }, []);
  useEffect(() => { if (draftRef.current && draftRef.current.ownerKey !== ownerKey()) clearReviewDraft(); }, [authStatus, sessionRevision, clearReviewDraft]);
  const [saved, setSaved] = useState<number[]>([]); const [savedReady, ready] = useState(false); const [savedError, fail] = useState(false);
  useEffect(() => { let active = true; AsyncStorage.getItem(SAVED_KEY).then(raw => { if (!active) return; const parsed: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) setSaved([...new Set(parsed.filter((value): value is number => Number.isSafeInteger(value) && value > 0))].slice(0, 100)); }).catch(() => { if (active) fail(true); }).finally(() => { if (active) ready(true); }); return () => { active = false; }; }, []);
  const toggleSaved = (hid: number) => { if (!savedReady || !Number.isSafeInteger(hid) || hid <= 0) return; const next = saved.includes(hid) ? saved.filter(id => id !== hid) : [...saved, hid].slice(-100); setSaved(next); void AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).then(() => fail(false)).catch(() => fail(true)); };
  const reviewDraft = storedDraft && storedDraft.ownerKey === ownerKey() && storedDraft.searchKey === criteriaIdentity(criteria) ? storedDraft : null;
  return <Context.Provider value={{ criteria, destinationName, setSearch: (value, name) => {
    criteriaRef.current = value; clearReviewDraft(); setCriteria(value); setDestinationName(name);
  }, saved, savedReady, savedError, toggleSaved, reviewDraft, setReviewDraft, getReviewDraft, clearReviewDraft }}>{children}</Context.Provider>;
}
export function useAppState() { const value = useContext(Context); if (!value) throw new Error('AppStateProvider missing'); return value; }
