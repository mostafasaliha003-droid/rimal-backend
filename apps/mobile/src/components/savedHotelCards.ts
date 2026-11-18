import type { HotelSummary } from '../types';
import { hotelPhotos, label, object } from '../api/adapters';
import { invalidResponse } from '../api/errors';
import { hotelId } from '../api/validation';

export interface SavedHotelCard {
  hid: number;
  name: string;
  address?: string;
  imageUrl?: string;
  images?: string[];
  stars?: number;
}

function displayText(value: unknown, limit: number): string {
  const text = label(value);
  return text.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text) ? text : '';
}

export function savedHotelCard(hid: number, value: unknown): SavedHotelCard {
  const hotel = object(value);
  if (hotelId(hotel.hid) !== hid || hotelId(hid) === null || hotel.deleted === true || hotel.is_closed === true) {
    throw invalidResponse();
  }
  const name = displayText(hotel.name, 500) || displayText(hotel.hotel_name, 500);
  const address = displayText(hotel.address, 1000);
  const stars = Number(hotel.star_rating ?? hotel.stars ?? hotel.starRating);
  const photos = hotelPhotos(hotel).slice(0, 8);
  return { hid, name, ...(address ? { address } : {}), ...(photos.length ? { imageUrl: photos[0], images: photos } : {}),
    ...(Number.isInteger(stars) && stars >= 1 && stars <= 5 ? { stars } : {}) };
}

export function returnedSavedHotels(ids: readonly number[], rows: readonly HotelSummary[]): HotelSummary[] {
  const remaining = new Set(ids);
  return rows.filter(row => remaining.delete(row.hid));
}

export async function loadSavedHotelCards(
  ids: readonly number[],
  load: (id: number) => Promise<unknown>,
  active: () => boolean,
  save: (id: number, card: SavedHotelCard | null) => void,
) {
  let position = 0;
  let stop = false;
  async function worker() {
    while (active() && !stop && position < ids.length) {
      const id = ids[position++];
      if (hotelId(id) === null) { save(id, null); continue; }
      try {
        const card = savedHotelCard(id, await load(id));
        if (active()) save(id, card);
      } catch (error) {
        if (!active()) return;
        save(id, null);
        const status = object(error).status;
        if (status === 401 || status === 403 || status === 429) stop = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ids.length, 3) }, worker));
  if (active() && stop) for (const id of ids.slice(position)) save(id, null);
}
