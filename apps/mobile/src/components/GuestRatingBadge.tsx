import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { GuestRating } from '../api/reviews';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space } from '../theme';
import { Row, Txt } from './Primitives';
import { ratingCount, ratingLabel, ratingScore, ratingWord, shownRating } from './guestRatingModel';

/**
 * Guest score as a small plum square with its word ("8.6 Excellent"), optionally with the number
 * of ratings. Nothing is drawn when there is no rating or too few to mean much.
 */
export default function GuestRatingBadge({ rating, showCount = false, testID }: { rating: GuestRating | null | undefined; showCount?: boolean; testID?: string }) {
  const { language } = useLanguage();
  const shown = shownRating(rating);
  if (!shown) return null;
  const word = ratingWord(shown.score, language);
  return <Row testID={testID} accessible accessibilityRole="text" accessibilityLabel={ratingLabel(shown, language)} style={{ gap: space.xs, flexShrink: 1 }}>
    <View style={styles.score}><Txt kind="micro" style={styles.scoreText}>{ratingScore(shown.score)}</Txt></View>
    {!!word && <Txt kind="caption" tone="primary" numberOfLines={1} style={{ fontFamily: fonts.medium, flexShrink: 0 }}>{word}</Txt>}
    {showCount && <Txt kind="caption" numberOfLines={1} style={{ flexShrink: 1 }}>· {ratingCount(shown.count, language)}</Txt>}
  </Row>;
}

const styles = StyleSheet.create({
  score: { minWidth: 30, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.xs, backgroundColor: color.bgBrand, alignItems: 'center' },
  scoreText: { color: color.textOnDark, fontFamily: fonts.bold, writingDirection: 'ltr' },
});
