export type Language = 'ar' | 'en' | 'es';
export type AppEnvironment = 'staging' | 'production';
export interface GuestRoom { adults: number; children: number[] }
export interface SearchCriteria {
  checkin: string; checkout: string; residency: string; guests: GuestRoom[];
  currency: string; language?: Language; regionId?: number; hids?: number[];
}
export interface Money { amount: string; currency: string }
export interface Tax {
  name: string; amount: string | null; currency_code: string | null;
  included_by_supplier: boolean | null;
}
export interface Suggestion {
  id: string; type: 'region' | 'hotel'; name: string; subtitle?: string;
  regionId?: number; hid?: number;
}
export interface CancellationInterval {
  startAt: string | null; endAt: string | null; amount: string | null; currency: string | null;
  startInvalid?: true; endInvalid?: true;
}
export interface RoomOffer {
  id: string; name: string; bookHash: string; offerContext?: string; roomIdentity?: string;
  price: Money | null; meal?: string; noChildMeal?: true; bedding?: string; paymentType?: 'deposit'; images: string[]; taxes: Tax[];
  cancellation: { freeUntil: string | null; policies: CancellationInterval[]; freeUntilInvalid?: true; incomplete?: true };
}
export interface HotelSummary {
  hid: number; id: string; name: string; address?: string; stars?: number;
  location?: { latitude: number; longitude: number };
  imageUrl?: string; images?: string[]; price: Money | null; offers: RoomOffer[];
}
export interface HotelDetails extends HotelSummary {
  description: string[]; amenities: string[]; images: string[];
  policyExtraInfo: string | null; policies: Record<string, unknown>;
}
export interface PrebookResult { offer: RoomOffer; priceChanged: boolean; prebookContext: string }
export interface User { name: string; email: string; phone?: string; points?: number }
export interface RegistrationInput { name: string; email: string; password: string; phone: string }
export interface TokenStorage {
  get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void>;
}
