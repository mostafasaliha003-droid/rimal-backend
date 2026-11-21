import type { CheckoutGuestData, CheckoutTraveler } from '../api/checkout';
import type { GuestRoom } from '../types';

export interface CheckoutTravelerDraft {
  guest: { firstName: string; lastName: string; email: string; phone: string; specialRequests: string };
  rooms: { guests: CheckoutTraveler[] }[];
}
export type TravelerError = 'required' | 'name' | 'email' | 'phone' | 'requests' | 'occupancy';
export interface TravelerValidation { data: CheckoutGuestData | null; errors: Record<string, TravelerError> }

function validOccupancy(rooms: GuestRoom[]) {
  return Array.isArray(rooms) && rooms.length >= 1 && rooms.length <= 9 && rooms.every(room => room
    && Number.isInteger(room.adults) && room.adults >= 1 && room.adults <= 6
    && Array.isArray(room.children) && room.children.length <= 4
    && room.children.every(age => Number.isInteger(age) && age >= 0 && age <= 17));
}
export function createTravelerDraft(occupancy: GuestRoom[]): CheckoutTravelerDraft | null {
  if (!validOccupancy(occupancy)) return null;
  return { guest: { firstName: '', lastName: '', email: '', phone: '', specialRequests: '' },
    rooms: occupancy.map(room => ({ guests: [
      ...Array.from({ length: room.adults }, () => ({ firstName: '', lastName: '', is_child: false })),
      ...room.children.map(age => ({ firstName: '', lastName: '', is_child: true, age })),
    ] })) };
}
/**
 * Families usually share a family name, so the lead guest's is offered to the other travelers.
 * Only a field that is empty, or still holds the name carried before, follows the lead guest; a
 * name the traveler typed is never overwritten. The lead guest's own slot is the contact name.
 */
export function carryFamilyName(draft: CheckoutTravelerDraft, previous: string, next: string): CheckoutTravelerDraft {
  return { ...draft, rooms: draft.rooms.map((room, r) => ({ guests: room.guests.map((person, p) =>
    (r === 0 && p === 0) || (person.lastName !== '' && person.lastName !== previous) ? person : { ...person, lastName: next }) })) };
}
export function normalizeCheckoutPhone(value: string): string {
  return value.trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/g, char => {
    const code = char.charCodeAt(0); return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  }).replace(/[ ()-]/g, '');
}
const controls = /[\u0000-\u001f\u007f]/;
// RateHawk accepts 1-50 unicode letters, spaces and ' - , . ’ in guest names; digits and other
// symbols are refused. Names reach RateHawk after payment, so they are checked before it.
export const GUEST_NAME_MAX = 50;
const guestNamePattern = /^\p{L}[\p{L} '\-,.\u2019]*$/u;

export function validateTravelerDraft(draft: CheckoutTravelerDraft, occupancy: GuestRoom[]): TravelerValidation {
  const errors: Record<string, TravelerError> = {};
  if (!validOccupancy(occupancy) || !draft?.guest || !Array.isArray(draft.rooms) || draft.rooms.length !== occupancy.length
    || draft.rooms[0]?.guests?.[0]?.is_child !== false) {
    return { data: null, errors: { occupancy: 'occupancy' } };
  }
  const name = (value: unknown, key: string) => {
    if (typeof value !== 'string' || !value.trim()) { errors[key] = 'required'; return ''; }
    if (value.trim().length > GUEST_NAME_MAX || controls.test(value) || !guestNamePattern.test(value.trim())) { errors[key] = 'name'; return ''; }
    return value.trim();
  };
  const firstName = name(draft.guest.firstName, 'firstName'), lastName = name(draft.guest.lastName, 'lastName');
  const rawEmail = draft.guest.email, email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
  if (!email) errors.email = 'required';
  else if (rawEmail.length > 254 || controls.test(rawEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'email';
  const rawPhone = draft.guest.phone, phone = typeof rawPhone === 'string' ? normalizeCheckoutPhone(rawPhone) : '';
  if (!phone) errors.phone = 'required';
  else if (rawPhone.length > 40 || !/^\+[1-9]\d{6,19}$/.test(phone)) errors.phone = 'phone';
  const request = draft.guest.specialRequests;
  if (typeof request !== 'string' || request.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request)) errors.specialRequests = 'requests';
  const rooms = draft.rooms.map((room, roomIndex) => {
    const expected = occupancy[roomIndex], people = room?.guests;
    if (!Array.isArray(people) || people.length !== expected.adults + expected.children.length) {
      errors.occupancy = 'occupancy'; return { guests: [] };
    }
    const adults = people.filter(person => person?.is_child === false).length;
    const ages = people.filter(person => person?.is_child === true).map(person => person.age).sort((a,b) => Number(a) - Number(b));
    if (adults !== expected.adults || JSON.stringify(ages) !== JSON.stringify([...expected.children].sort((a,b) => a-b))) errors.occupancy = 'occupancy';
    // The native form allocates fixed occurrences: do not let a mutated draft
    // move a name onto another child's age or move a child into an adult slot.
    if (people.some((person,index) => index < expected.adults ? person?.is_child !== false
      : person?.is_child !== true || person.age !== expected.children[index-expected.adults])) errors.occupancy = 'occupancy';
    return { guests: people.map((person, personIndex) => {
      const lead = roomIndex === 0 && personIndex === 0;
      return { firstName: lead ? firstName : name(person?.firstName, `traveler-${roomIndex}-${personIndex}-firstName`),
        lastName: lead ? lastName : name(person?.lastName, `traveler-${roomIndex}-${personIndex}-lastName`),
        is_child: person?.is_child === true, ...(person?.is_child === true ? { age: person.age } : {}) };
    }) };
  });
  if (Object.keys(errors).length) return { data: null, errors };
  return { data: { guest: { firstName, lastName, email, phone, ...(request.trim() ? { specialRequests: request.trim() } : {}) }, rooms }, errors };
}
