import React from 'react';
import { View } from 'react-native';
import type { Tax } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { MoneyText, Txt } from './Primitives';

export default function Taxes({ taxes = [] }: { taxes: Tax[] }) {
  const { t } = useLanguage();
  if (!taxes.length) return null;
  return <View style={{ gap: 10 }}><Txt kind="label">{t('taxes')}</Txt>{taxes.map((tax, index) => <View key={index} style={{ padding: 13, borderRadius: 13, gap: 5, backgroundColor: colors.background }}><Txt style={{ fontFamily: fonts.medium }}>{tax.name.replace(/_/g, ' ')}</Txt>{tax.amount !== null && tax.currency_code ? <MoneyText money={{ amount: tax.amount, currency: tax.currency_code }} /> : <Txt kind="small">{tax.amount === null ? `${t('amountUnknown')}${tax.currency_code ? ` · ${tax.currency_code}` : ''}` : `${tax.amount} · ${t('taxCurrencyUnknown')}`}</Txt>}<Txt kind="small" style={{ color: tax.included_by_supplier === false ? colors.red : colors.muted }}>{t(tax.included_by_supplier === true ? 'taxIncluded' : tax.included_by_supplier === false ? 'taxExcluded' : 'taxUnknown')}</Txt></View>)}<Txt kind="small">{t('taxNote')}</Txt></View>;
}
