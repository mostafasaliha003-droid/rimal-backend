import { Platform } from 'react-native';
import type { DocumentUpload } from '../api/transport';
import { ApiError } from '../api/errors';

async function chooseWebFile() {
  return new Promise<globalThis.File | null>(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png';
    const finish = (file: globalThis.File | null) => { input.remove(); resolve(file); };
    input.onchange = () => finish(input.files?.[0] || null);
    input.oncancel = () => finish(null);
    input.style.display = 'none'; document.body.appendChild(input); input.click();
  });
}

export async function chooseMembershipDocument(): Promise<DocumentUpload | null> {
  let file: Pick<Blob, 'type' | 'size' | 'arrayBuffer'> | null;
  if (Platform.OS === 'web') file = await chooseWebFile();
  else {
    const { File } = await import('expo-file-system');
    const pick = await File.pickFileAsync({ mimeTypes: ['image/jpeg', 'image/png'] });
    file = pick.canceled ? null : pick.result;
  }
  if (!file) return null;
  const mime = file.type.toLowerCase();
  if ((mime !== 'image/jpeg' && mime !== 'image/png') || !Number.isSafeInteger(file.size) || file.size < 33 || file.size > 5 * 1024 * 1024)
    throw new ApiError('validation', 'invalid_document_image');
  return { mime, bytes: await file.arrayBuffer() };
}
