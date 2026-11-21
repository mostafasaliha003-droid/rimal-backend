/**
 * What a result card already showed (photo, name, stars, address), handed to the hotel page so
 * it opens on the same picture while rooms and terms load. Session memory only, never stored;
 * it never stands in for supplier data once the hotel page has loaded.
 */
export interface HotelPreview { name: string; photo?: string; stars?: number; address?: string }

const previews = new Map<number, HotelPreview>();
const LIMIT = 40;

export function rememberHotelPreview(hid: number, preview: HotelPreview) {
  previews.delete(hid);
  previews.set(hid, preview);
  while (previews.size > LIMIT) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
}

export function hotelPreview(hid: number | null): HotelPreview | null {
  return hid === null ? null : previews.get(hid) ?? null;
}
