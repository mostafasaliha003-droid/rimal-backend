import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api, APP_ENV } from '../api';
import { useLanguage } from '../i18n';
import type { Money } from '../types';
import { bookingCurrency } from './currencyCatalog';
import { useCurrencyPreference } from './useCurrencyPreference';
import { displayEstimate, readDisplayQuotes, type DisplayQuote } from './displayEstimateModel';
import { Txt } from './Primitives';

const Context = createContext({ code: '', quotes: {} as Record<string, DisplayQuote>, pending: false });

export function StayEstimateProvider({ children }: {children: React.ReactNode}) {
  const {currency, ready} = useCurrencyPreference();
  const needed = ready && bookingCurrency(currency, APP_ENV) !== currency;
  const [quotes, setQuotes] = useState<Record<string, DisplayQuote>>({});
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    let lastCheck = 0, inFlight = false;
    const refresh = async () => {
      if (inFlight || Date.now() - lastCheck < 5 * 60_000 || controller.signal.aborted) return;
      inFlight = true; lastCheck = Date.now(); setPending(true);
      try {
        const data = await api.worldDisplayRates(controller.signal);
        if (!controller.signal.aborted) setQuotes(readDisplayQuotes(data));
      } catch { /* Existing dated estimates expire independently. */ }
      finally { inFlight = false; if (!controller.signal.aborted) setPending(false); }
    };
    void refresh();
    const timer = setInterval(refresh, 30 * 60_000);
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => { controller.abort(); clearInterval(timer); listener.remove(); };
  }, [needed]);
  return <Context.Provider value={{code: needed ? currency : '', quotes, pending}}>{children}</Context.Provider>;
}

export default function StayEstimate({ money }: {money?: Money | null}) {
  const {code, quotes, pending} = useContext(Context), { language } = useLanguage();
  if (!code || !money || code === money.currency) return null;
  const estimate = displayEstimate(money, code, quotes, language);
  if (!estimate && pending) return null;
  const ar = language === 'ar';
  return <Txt testID="stay-currency-estimate" kind="small">{estimate
    ? (ar ? `تقريباً ${estimate.text} · صرف ${estimate.date}` : `Approx. ${estimate.text} · FX ${estimate.date}`)
    : (ar ? `لا يتوفر تقدير حديث بـ ${code}. السعر المعروض بـ ${money.currency}.` : `No current ${code} estimate. Price shown in ${money.currency}.`)}</Txt>;
}
