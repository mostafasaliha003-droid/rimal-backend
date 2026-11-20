import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../api';
import type { Money } from '../types';
import { paymentCurrency } from './currencyCatalog';
import { convertMoney, readChargeRates, type ChargeRates } from './chargeCurrencyModel';
import { useCurrencyPreference } from './useCurrencyPreference';

const Context = createContext<{ code: string; table: ChargeRates | null }>({ code: 'USD', table: null });

/** Loads the booking server's payment rates for the guest's payment currency. */
export function ChargeCurrencyProvider({ children }: { children: React.ReactNode }) {
  const { currency } = useCurrencyPreference();
  const code = paymentCurrency(currency);
  const [table, setTable] = useState<ChargeRates | null>(null);
  const needed = code !== 'USD';
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    let lastCheck = 0, inFlight = false;
    const refresh = async () => {
      if (inFlight || Date.now() - lastCheck < 2 * 60_000 || controller.signal.aborted) return;
      inFlight = true; lastCheck = Date.now();
      try {
        const next = readChargeRates(await api.paymentRates(controller.signal));
        if (next && !controller.signal.aborted) setTable(next);
      } catch { /* Prices stay in US dollars until rates are available. */ }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5 * 60_000);
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => { controller.abort(); clearInterval(timer); listener.remove(); };
  }, [needed]);
  return <Context.Provider value={{ code, table }}>{children}</Context.Provider>;
}

/** Converts a supplier (USD) price into the payment currency; falls back to the original price. */
export function useChargeMoney() {
  const { code, table } = useContext(Context);
  return useCallback(<T extends Money | null | undefined>(money: T): T | Money => {
    if (!money || money.currency === code) return money;
    return convertMoney(money, code, table) ?? money;
  }, [code, table]);
}

/** The currency prices are currently shown and charged in. */
export function useChargeCurrency() {
  const { code, table } = useContext(Context);
  return { code: code !== 'USD' && !table ? 'USD' : code, selected: code };
}
