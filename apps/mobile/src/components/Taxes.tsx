import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Tax } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Row, Txt } from './Primitives';
import { presentTaxes } from './taxPresentationModel';
import { taxCopy, taxName } from './taxCopy';

export interface TaxesProps {
  taxes?: readonly Tax[];
  defaultExpanded?: boolean;
  mode?: 'current' | 'historical' | 'updated';
  summaryOnly?: boolean;
}

export default function Taxes({ taxes, defaultExpanded = false, mode = 'current', summaryOnly = false }: TaxesProps) {
  const { language } = useLanguage();
  const copy = taxCopy(language);
  const model = useMemo(() => presentTaxes(taxes), [taxes]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const includedOnly = model.rows.length > 0 && model.rows.every(row => row.inclusion === 'included');
  const unclearInclusion = model.rows.some(row => row.inclusion === 'unknown');
  const incompleteValues = model.rows.some(row => !row.amountValid || !row.currencyValid);

  return (
    <View testID="taxes" style={{ gap: 10 }}>
      <Txt kind="label">{copy.title}</Txt>
      {mode !== 'current' && <Txt kind="small">{copy[mode === 'historical' ? 'historical' : 'updated']}</Txt>}
      <View testID="taxes-summary" style={{ gap: 7 }}>
        {model.dataState === 'notSupplied' ? <Txt kind="small">{copy.informationMissing}</Txt> : (
          <>
            {model.hasExcluded && (
              <View style={{ gap: 6 }}>
                <Txt kind="label" style={{ color: colors.navy }}>{copy.payable}</Txt>
                {model.excludedGroups.map(group => (
                  <View key={group.currency} testID={`taxes-excluded-${group.currency}`} style={{ gap: 3 }}>
                    {group.complete && group.subtotal ? (
                      <Txt style={{ fontFamily: fonts.bold, color: colors.navy, fontSize: 19, lineHeight: 28,
                        writingDirection: 'ltr', flexShrink: 1 }}>
                        {group.subtotal.currency} {group.subtotal.amount}
                      </Txt>
                    ) : <Txt kind="label">{group.currency} · {copy.totalUnknown}</Txt>}
                  </View>
                ))}
                {model.unassignedExcluded.length > 0 && <Txt kind="small">{copy.currencyUnknown} · {copy.totalUnknown}</Txt>}
                <Txt kind="small">{copy.excludedNote}</Txt>
              </View>
            )}
            {includedOnly && <Txt kind="small">{copy.includedOnly}</Txt>}
            {unclearInclusion && <Txt kind="small">{copy.inclusionUnknown}</Txt>}
            {incompleteValues && <Txt kind="small">{copy.detailsMissing}</Txt>}
            {model.excludedGroups.length > 1 && <Txt kind="small">{copy.originalCurrencies}</Txt>}
          </>
        )}
      </View>
      {!summaryOnly && model.rows.length > 0 && (
        <View style={{ gap: 10 }}>
          <Pressable testID="taxes-breakdown-toggle" accessibilityRole="button"
            accessibilityState={{ expanded }} aria-expanded={expanded}
            onPress={() => setExpanded(value => !value)}
            style={{ minHeight: 48, paddingVertical: 11, justifyContent: 'center' }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" style={{ color: colors.blueStrong, flex: 1 }}>{copy.breakdown(model.rows.length)}</Txt>
              <Txt accessible={false} style={{ color: colors.blueStrong }}>{expanded ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {expanded && model.rows.map(row => (
            <View key={row.index} testID={`taxes-row-${row.index}`} style={{ padding: 13, borderRadius: 13,
              gap: 5, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
              <Txt style={{ fontFamily: fonts.medium }}>{taxName(row.name, language)}</Txt>
              {row.money ? (
                <Txt style={{ fontFamily: fonts.bold, writingDirection: 'ltr', flexShrink: 1 }}>
                  {row.money.currency} {row.money.amount}
                </Txt>
              ) : (
                <View style={{ gap: 3 }}>
                  {row.amountValid ? <Txt style={{ writingDirection: 'ltr' }}>{row.amount}</Txt> : <Txt kind="small">{copy.amountUnknown}</Txt>}
                  <Txt kind="small" style={row.currencyValid ? { writingDirection: 'ltr' } : undefined}>
                    {row.currencyValid ? row.currency : copy.currencyUnknown}
                  </Txt>
                </View>
              )}
              <Txt kind="small">{copy[row.inclusion]}</Txt>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
