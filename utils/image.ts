type ImageCompressionOptions = {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  mimeType?: string;
};

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = dataUrl;
  });

export const compressImageFile = async (
  file: File,
  options: ImageCompressionOptions
): Promise<string> => {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(
    1,
    options.maxWidth / image.width,
    options.maxHeight / image.height
  );
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return dataUrl;
  }

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const mimeType =
    options.mimeType || (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  const quality = options.quality ?? 0.82;
  const output = canvas.toDataURL(mimeType, quality);

  return output && output !== 'data:,' ? output : dataUrl;
};
