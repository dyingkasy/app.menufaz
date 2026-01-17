type ImageTransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
};

const buildTransform = (options: ImageTransformOptions) => {
  const parts: string[] = ['f-auto'];
  if (options.width) parts.push(`w-${Math.round(options.width)}`);
  if (options.height) parts.push(`h-${Math.round(options.height)}`);
  if (options.quality) parts.push(`q-${Math.round(options.quality)}`);
  return parts.join(',');
};

export const imageKitUrl = (url: string, options: ImageTransformOptions = {}) => {
  if (!url) return url;
  if (!url.includes('ik.imagekit.io')) return url;
  const transform = buildTransform(options);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}tr=${transform}`;
};
