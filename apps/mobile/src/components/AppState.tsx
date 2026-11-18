import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HotelSummary, SearchCriteria } from '../types';
import { APP_ENV, authSession } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { copyCriteria, createOfferReviewDraft, criteriaIdentity, type OfferReviewDraft, type OfferReviewInput } from './offerReviewModel';
import type { CheckoutSelection } from './checkoutSessionModel';
import { addRecentSearch, comparisonItemsFor, emptyComparison, emptyRecentSearches, recentSearchesFor,
  removeComparisonSelection, toggleComparisonSelection, type ComparisonHotel, type ComparisonOutcome,
  type ComparisonSelection, type RecentSearch, type RecentSearchSelection } from './discoverySessionModel';

export type { ComparisonHotel, RecentSearch } from './discoverySessionModel';

type State = { criteria: SearchCriteria | null; destinationName: string; setSearch: (criteria: SearchCriteria, name: string) => void;
  saved: number[]; savedReady: boolean; savedError: boolean; toggleSaved: (hid: number) => void;
  reviewDraft: OfferReviewDraft | null; setReviewDraft: (input: OfferReviewInput) => boolean;
  getReviewDraft: () => OfferReviewDraft | null; clearReviewDraft: () => void;
  getCheckoutReview: () => CheckoutSelection | null;
  setCheckoutReviewAuthority: (authority: () => CheckoutSelection | null) => boolean;
  clearCheckoutReview: () => void;
  comparisonContextKey: string; comparisonItems: ComparisonHotel[];
  getComparisonItems: (expectedContextKey: string) => ComparisonHotel[];
  toggleComparison: (hotel: HotelSummary, expectedContextKey: string) => ComparisonOutcome;
  removeComparison: (hid: number, expectedContextKey: string) => void; clearComparison: () => void;
  recentSearches: RecentSearch[]; getRecentSearches: () => RecentSearch[]; clearRecentSearches: () => void };
const Context = createContext<State | null>(null);
const SAVED_KEY = 'remal.savedHotelIds.v1';
const ownerKey = () => `${APP_ENV}:${authSession.getSnapshot().status}:${authSession.getRevision()}`;
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, sessionRevision } = useAuth();
  const { language } = useLanguage();
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null); const [destinationName, setDestinationName] = useState('');
  const criteriaRef = useRef<SearchCriteria | null>(null);
  const comparisonRef = useRef<ComparisonSelection>(emptyComparison());
  const [comparison, storeComparison] = useState<ComparisonSelection>(emptyComparison);
  const recentRef = useRef<RecentSearchSelection>(emptyRecentSearches());
  const [recent, storeRecent] = useState<RecentSearchSelection>(emptyRecentSearches);
  const getContextKey = useCallback(() => criteriaRef.current && authSession.getSnapshot().status !== 'loading'
    ? JSON.stringify([ownerKey(), criteriaIdentity(criteriaRef.current), languageRef.current]) : '', []);
  const clearComparison = useCallback(() => { comparisonRef.current = emptyComparison(); storeComparison(comparisonRef.current); }, []);
  const clearRecentSearches = useCallback(() => { recentRef.current = emptyRecentSearches(); storeRecent(recentRef.current); }, []);
  const getRecentSearches = useCallback(() => recentSearchesFor(recentRef.current,
    authSession.getSnapshot().status === 'loading' ? '' : ownerKey()), []);
  const getComparisonItems = useCallback((expectedContextKey: string) => {
    const context = getContextKey();
    return expectedContextKey === context ? comparisonItemsFor(comparisonRef.current, context) : [];
  }, [getContextKey]);
  const toggleComparison = useCallback((hotel: HotelSummary, expectedContextKey: string) => {
    const result = toggleComparisonSelection(comparisonRef.current, hotel, getContextKey(), expectedContextKey, criteriaRef.current?.currency || '');
    comparisonRef.current = result.selection; storeComparison(result.selection); return result.outcome;
  }, [getContextKey]);
  const removeComparison = useCallback((hid: number, expectedContextKey: string) => {
    const next = removeComparisonSelection(comparisonRef.current, hid, getContextKey(), expectedContextKey);
    comparisonRef.current = next; storeComparison(next);
  }, [getContextKey]);
  useEffect(() => { clearComparison(); }, [authStatus, sessionRevision, language, clearComparison]);
  useEffect(() => { clearRecentSearches(); }, [authStatus, sessionRevision, clearRecentSearches]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!comparison.items.length) return;
    const timer = setInterval(() => tick(value => value + 1), 15_000);
    return () => clearInterval(timer);
  }, [comparison.items.length]);
  const draftRef = useRef<OfferReviewDraft | null>(null);
  const checkoutAuthority = useRef<{ draftId: string; read: () => CheckoutSelection | null } | null>(null);
  const clearCheckoutReview = useCallback(() => { checkoutAuthority.current = null; }, []);
  const [storedDraft, storeDraft] = useState<OfferReviewDraft | null>(null);
  const clearReviewDraft = useCallback(() => { checkoutAuthority.current = null; draftRef.current = null; storeDraft(null); }, []);
  const getReviewDraft = useCallback(() => {
    const draft = draftRef.current;
    return draft && draft.ownerKey === ownerKey() && draft.searchKey === criteriaIdentity(criteriaRef.current) ? draft : null;
  }, []);
  const getCheckoutReview = useCallback(() => {
    const current = getReviewDraft(), authority = checkoutAuthority.current;
    if (!current || !authority || current.id !== authority.draftId) return null;
    const proof = authority.read();
    return proof && proof.expiresAt > Date.now() ? proof : null;
  }, [getReviewDraft]);
  const setCheckoutReviewAuthority = useCallback((read: () => CheckoutSelection | null) => {
    const current = getReviewDraft(), proof = read();
    if (!current || !proof || proof.expiresAt <= Date.now() || proof.review.hid !== current.hid
      || criteriaIdentity(proof.review.criteria) !== current.searchKey) return false;
    checkoutAuthority.current = { draftId: current.id, read }; return true;
  }, [getReviewDraft]);
  const setReviewDraft = useCallback((input: OfferReviewInput) => {
    if (authSession.getSnapshot().status === 'loading' || criteriaIdentity(input.criteria) !== criteriaIdentity(criteriaRef.current)) return false;
    const draft = createOfferReviewDraft(input, ownerKey());
    if (!draft) return false;
    checkoutAuthority.current = null;
    draftRef.current = draft; storeDraft(draft); return true;
  }, []);
  useEffect(() => { if (draftRef.current && draftRef.current.ownerKey !== ownerKey()) clearReviewDraft(); }, [authStatus, sessionRevision, clearReviewDraft]);
  const [saved, setSaved] = useState<number[]>([]); const [savedReady, ready] = useState(false); const [savedError, fail] = useState(false);
  useEffect(() => { let active = true; AsyncStorage.getItem(SAVED_KEY).then(raw => { if (!active) return; const parsed: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) setSaved([...new Set(parsed.filter((value): value is number => Number.isSafeInteger(value) && value > 0))].slice(0, 100)); }).catch(() => { if (active) fail(true); }).finally(() => { if (active) ready(true); }); return () => { active = false; }; }, []);
  const toggleSaved = (hid: number) => { if (!savedReady || !Number.isSafeInteger(hid) || hid <= 0) return; const next = saved.includes(hid) ? saved.filter(id => id !== hid) : [...saved, hid].slice(-100); setSaved(next); void AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).then(() => fail(false)).catch(() => fail(true)); };
  const reviewDraft = storedDraft && storedDraft.ownerKey === ownerKey() && storedDraft.searchKey === criteriaIdentity(criteria) ? storedDraft : null;
  const comparisonContextKey = criteria && authStatus !== 'loading'
    ? JSON.stringify([`${APP_ENV}:${authStatus}:${sessionRevision}`, criteriaIdentity(criteria), language]) : '';
  const comparisonItems = comparisonItemsFor(comparison, comparisonContextKey);
  const recentSearches = recentSearchesFor(recent, authSession.getSnapshot().status === 'loading' ? '' : ownerKey());
  return <Context.Provider value={{ criteria, destinationName, setSearch: (value, name) => {
    const next = copyCriteria(value);
    criteriaRef.current = next; clearReviewDraft(); clearComparison(); setCriteria(next); setDestinationName(name);
    if (authSession.getSnapshot().status !== 'loading') {
      recentRef.current = addRecentSearch(recentRef.current, ownerKey(), next, name); storeRecent(recentRef.current);
    }
  }, saved, savedReady, savedError, toggleSaved, reviewDraft, setReviewDraft, getReviewDraft, clearReviewDraft,
    getCheckoutReview, setCheckoutReviewAuthority, clearCheckoutReview,
    comparisonContextKey, comparisonItems, getComparisonItems, toggleComparison, removeComparison, clearComparison,
    recentSearches, getRecentSearches, clearRecentSearches }}>{children}</Context.Provider>;
}
export function useAppState() { const value = useContext(Context); if (!value) throw new Error('AppStateProvider missing'); return value; }
