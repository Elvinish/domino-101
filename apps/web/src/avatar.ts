/** Local presentation only: never added to room messages or reconnect data. */
export const avatarStorageKey = 'domino101.avatar';
const rasterDataUrl = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function readAvatar(): string | undefined {
  try {
    const value = localStorage.getItem(avatarStorageKey);
    return value && value.length < 64_000 && rasterDataUrl.test(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export async function prepareAvatar(file: File): Promise<string> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size === 0 ||
    file.size > 5 * 1024 * 1024
  ) {
    throw new Error('Invalid avatar');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 24_000_000
    ) {
      throw new Error('Invalid avatar');
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unavailable canvas');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#e9d5b3';
    context.fillRect(0, 0, 128, 128);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
