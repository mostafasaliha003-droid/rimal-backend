import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../api';
import type { HotelReview, HotelReviewsPage, ReviewCategory } from '../api/hotelReviews';
import { hotelId } from '../api/validation';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import { Button, Card, Icon, Row, Skeleton, StatePanel, Txt } from '../components/Primitives';
import { MIN_RATINGS, ratingCount, ratingScore, ratingWord } from '../components/guestRatingModel';
import { hotelPreview } from '../components/hotelPreview';

const CATEGORY_NAMES: Record<ReviewCategory, [string, string]> = {
  cleanness: ['النظافة', 'Cleanliness'], location: ['الموقع', 'Location'], price: ['القيمة مقابل السعر', 'Value for money'],
  services: ['الخدمات', 'Services'], room: ['الغرفة', 'Room'], meal: ['الوجبات', 'Meals'],
};

// A review keeps its own direction (an English review stays left-to-right inside the Arabic app).
const direction = (value: string) => /[֐-ࣿ]/.test(value) ? 'rtl' as const : 'ltr' as const;

/** One guest's words: what they liked and what they did not, in the language they wrote. */
function ReviewCard({ review }: { review: HotelReview }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const when = review.publishedAt ? new Intl.DateTimeFormat(ar ? 'ar-AE-u-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(review.publishedAt)) : '';
  const stay = [review.roomName, review.nights ? (ar ? `${review.nights} ${review.nights === 1 ? 'ليلة' : review.nights === 2 ? 'ليلتان' : review.nights <= 10 ? 'ليالٍ' : 'ليلة'}` : `${review.nights} night${review.nights === 1 ? '' : 's'}`) : ''].filter(Boolean).join(' · ');
  return <Card style={styles.review}>
    <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="label" tone="primary" numberOfLines={1}>{review.author || (ar ? 'ضيف' : 'Guest')}</Txt>
        {!!when && <Txt kind="caption">{when}</Txt>}
      </View>
      {review.rating !== null && <View style={styles.scoreSmall}><Txt kind="micro" style={styles.scoreText}>{ratingScore(review.rating)}</Txt></View>}
    </Row>
    {!!review.positive && <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
      <View style={[styles.mark, { backgroundColor: color.successBg }]}><Icon name="plus" size={12} strokeWidth={3} color={color.success}/></View>
      <Txt kind="small" tone="primary" style={{ flex: 1, writingDirection: direction(review.positive) }}>{review.positive}</Txt></Row>}
    {!!review.negative && <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
      <View style={[styles.mark, { backgroundColor: color.bgSubtle }]}><Icon name="minus" size={12} strokeWidth={3} color={color.textSecondary}/></View>
      <Txt kind="small" tone="primary" style={{ flex: 1, writingDirection: direction(review.negative) }}>{review.negative}</Txt></Row>}
    {!!stay && <Txt kind="caption" numberOfLines={1}>{stay}</Txt>}
  </Card>;
}

/*
 * The full guest picture for one hotel: the average, what guests rated by category, then their
 * own words, newest first, ten at a time. Nothing is translated or summarised by the app.
 */
export default function HotelReviewsScreen() {
  const { hid: param } = useLocalSearchParams<{ hid?: string }>();
  const hid = hotelId(Number(param));
  const { language } = useLanguage();
  const ar = language === 'ar';
  const [attempt, setAttempt] = useState(0);
  const [first, setFirst] = useState<{ attempt: number; page: HotelReviewsPage | null; error: unknown } | null>(null);
  const [more, setMore] = useState<{ reviews: HotelReview[]; next: number; hasMore: boolean; loading: boolean }>({ reviews: [], next: 0, hasMore: false, loading: false });
  const name = hid !== null ? hotelPreview(hid)?.name : undefined;

  useEffect(() => {
    if (hid === null) return;
    const controller = new AbortController();
    api.getHotelReviews(hid, language, 0, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setFirst({ attempt, page, error: null });
      setMore({ reviews: page.reviews, next: page.nextOffset, hasMore: page.hasMore, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setFirst({ attempt, page: null, error }); });
    return () => controller.abort();
  }, [hid, language, attempt]);

  // RateHawk is still preparing this hotel's reviews: ask again shortly.
  const page = first?.attempt === attempt ? first.page : null;
  const checkingDelay = page?.status === 'checking' ? page.retryAfterMs : null;
  useEffect(() => {
    if (checkingDelay === null) return;
    const timer = setTimeout(() => setAttempt(value => value + 1), checkingDelay);
    return () => clearTimeout(timer);
  }, [checkingDelay]);

  const loadMore = () => {
    if (hid === null || more.loading || !more.hasMore) return;
    setMore(current => ({ ...current, loading: true }));
    api.getHotelReviews(hid, language, more.next).then(next => setMore(current => ({
      reviews: [...current.reviews, ...next.reviews.filter(item => !current.reviews.some(seen => seen.id === item.id))],
      next: next.nextOffset, hasMore: next.hasMore, loading: false,
    }))).catch(() => setMore(current => ({ ...current, loading: false })));
  };

  const title = <View style={{ gap: 2 }}>
    <Txt kind="heading" accessibilityRole="header">{ar ? 'تقييمات الضيوف' : 'Guest reviews'}</Txt>
    {!!name && <Txt kind="small" numberOfLines={1}>{name}</Txt>}
  </View>;

  const shown = page && page.score !== null && page.ratedCount >= MIN_RATINGS;
  const header = <View style={{ gap: space.md, paddingBottom: space.sm }}>
    {title}
    {page && shown && <Card testID="reviews-summary" style={styles.summary}>
      <Row style={{ gap: space.md }}>
        <View style={styles.scoreLarge}><Txt style={styles.scoreLargeText}>{ratingScore(page.score!)}</Txt></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt kind="subheading">{ratingWord(page.score!, language) || (ar ? 'تقييم الضيوف' : 'Guest rating')}</Txt>
          <Txt kind="small">{ar ? `من 10 · ${ratingCount(page.ratedCount, language)}` : `out of 10 · ${ratingCount(page.ratedCount, language)}`}</Txt>
        </View>
      </Row>
      {page.categories.length > 0 && <View style={{ gap: space.sm }}>
        {page.categories.map(category => <View key={category.key} style={{ gap: 3 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt kind="small" tone="primary">{CATEGORY_NAMES[category.key][ar ? 0 : 1]}</Txt>
            <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr' }}>{ratingScore(category.score)}</Txt>
          </Row>
          <View style={styles.track} accessible={false}><View style={[styles.fill, { width: `${Math.max(4, category.score * 10)}%` }, ar ? { alignSelf: 'flex-end' } : null]}/></View>
        </View>)}
      </View>}
    </Card>}
    {page && more.reviews.length > 0 && <Row style={{ gap: space.xs }}><Icon name="info" size={14} color={color.textSecondary}/>
      <Txt kind="caption" style={{ flex: 1 }}>{ar ? 'تظهر التقييمات بلغتها الأصلية كما كتبها الضيوف، الأحدث أولاً.' : 'Reviews appear as guests wrote them, newest first.'}</Txt></Row>}
  </View>;

  let empty: React.ReactNode = null;
  if (hid === null) empty = <StatePanel icon="alertCircle" title={ar ? 'لم نجد هذا الفندق' : 'Hotel not found'}/>;
  else if (first?.attempt === attempt && first.error) empty = <ApiState error={first.error} retry={() => setAttempt(value => value + 1)}/>;
  else if (!page || page.status === 'checking') empty = <View style={{ gap: space.md }} accessibilityLabel={ar ? 'نحمّل التقييمات' : 'Loading reviews'}>
    <Skeleton height={150} rounded={radius.lg}/><Skeleton height={110} rounded={radius.lg}/><Skeleton height={110} rounded={radius.lg}/></View>;
  else if (page.status === 'unavailable') empty = <StatePanel icon="alertCircle" title={ar ? 'تعذّر تحميل التقييمات' : 'Reviews unavailable'}
    body={ar ? 'حاول مجدداً بعد قليل.' : 'Please try again shortly.'}><Button variant="secondary" icon="refresh" title={ar ? 'إعادة المحاولة' : 'Try again'} onPress={() => setAttempt(value => value + 1)}/></StatePanel>;
  else if (page.status === 'empty' || more.reviews.length === 0) empty = <StatePanel icon="star" title={ar ? 'لا توجد تقييمات بعد' : 'No reviews yet'}
    body={ar ? 'لم يكتب الضيوف تقييمات لهذا الفندق بعد لدى مورّدنا.' : 'Guests have not reviewed this hotel with our supplier yet.'}/>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <FlatList data={empty ? [] : more.reviews} keyExtractor={item => item.id} contentContainerStyle={[ui.page, { gap: space.md }]}
      ListHeaderComponent={header} ListEmptyComponent={empty ? <>{empty}</> : undefined}
      renderItem={({ item }) => <ReviewCard review={item}/>}
      ListFooterComponent={more.hasMore && !empty ? <Button testID="reviews-more" variant="secondary" busy={more.loading} title={ar ? 'عرض تقييمات أخرى' : 'Show more reviews'} onPress={loadMore}/> : undefined}/>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  summary: { gap: space.lg, padding: space.md },
  scoreLarge: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: color.bgBrand, alignItems: 'center', justifyContent: 'center' },
  scoreLargeText: { color: color.textOnDark, fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, writingDirection: 'ltr' },
  track: { height: 6, borderRadius: 3, backgroundColor: color.bgField, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.bgBrand },
  review: { gap: space.sm, padding: space.md },
  scoreSmall: { minWidth: 32, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: color.bgBrand, alignItems: 'center' },
  scoreText: { color: color.textOnDark, fontFamily: fonts.bold, writingDirection: 'ltr' },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
