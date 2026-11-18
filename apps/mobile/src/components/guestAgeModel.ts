export function childAgeInput(text: string): number | '' {
  const ascii = text.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)));
  return /^\d{1,2}$/.test(ascii) ? Number(ascii) : '';
}

export interface GuestRoomDraft { adults: number; children: (number | '')[] }

export function appendRoomWithSameCounts(rooms: GuestRoomDraft[], sourceIndex: number): GuestRoomDraft[] {
  const source = rooms[sourceIndex];
  if (rooms.length >= 9 || !Number.isInteger(sourceIndex) || !source
      || !Number.isInteger(source.adults) || source.adults < 1 || source.adults > 6
      || !Array.isArray(source.children) || source.children.length > 4) return rooms;
  return [...rooms, { adults: source.adults, children: Array<number | ''>(source.children.length).fill('') }];
}

export function isValidChildAge(age: number | ''): age is number {
  return typeof age === 'number' && Number.isInteger(age) && age >= 0 && age <= 17;
}

export function firstInvalidChildAge(rooms: readonly GuestRoomDraft[]): { roomIndex: number; childIndex: number } | null {
  for (const [roomIndex, room] of rooms.entries()) {
    const childIndex = room.children.findIndex(age => !isValidChildAge(age));
    if (childIndex >= 0) return { roomIndex, childIndex };
  }
  return null;
}
