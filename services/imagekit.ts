import { getAuthToken } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const IMAGEKIT_PUBLIC_KEY = import.meta.env.VITE_IMAGEKIT_PUBLIC_KEY || '';
const IMAGEKIT_URL_ENDPOINT = import.meta.env.VITE_IMAGEKIT_URL_ENDPOINT || '';
const IMAGEKIT_FOLDER = import.meta.env.VITE_IMAGEKIT_FOLDER || '';

type ImageKitAuth = {
  token: string;
  expire: number;
  signature: string;
};

type ImageKitUploadResponse = {
  url: string;
  fileId: string;
  thumbnailUrl?: string;
};

const ensureImageKit = () => {
  if (!API_BASE_URL) throw new Error('API base URL not configured');
  if (!IMAGEKIT_PUBLIC_KEY) throw new Error('ImageKit public key not configured');
  if (!IMAGEKIT_URL_ENDPOINT) throw new Error('ImageKit URL endpoint not configured');
};

const fetchAuth = async (): Promise<ImageKitAuth> => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const response = await fetch(`${API_BASE_URL}/imagekit/auth`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`ImageKit auth failed: ${response.status}`);
  }
  return response.json();
};

export const uploadImageKit = async (file: File | string, fileName: string): Promise<ImageKitUploadResponse> => {
  ensureImageKit();
  const auth = await fetchAuth();

  const form = new FormData();
  form.append('file', file);
  form.append('fileName', fileName);
  form.append('publicKey', IMAGEKIT_PUBLIC_KEY);
  form.append('signature', auth.signature);
  form.append('token', auth.token);
  form.append('expire', String(auth.expire));
  if (IMAGEKIT_FOLDER) {
    form.append('folder', IMAGEKIT_FOLDER);
  }

  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    body: form
  });
  if (!response.ok) {
    throw new Error(`ImageKit upload failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    url: data.url || `${IMAGEKIT_URL_ENDPOINT}${data.filePath || ''}`,
    fileId: data.fileId,
    thumbnailUrl: data.thumbnailUrl
  };
};

export const deleteImageKit = async (fileId: string): Promise<void> => {
  if (!fileId) return;
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const response = await fetch(`${API_BASE_URL}/imagekit/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`ImageKit delete failed: ${response.status}`);
  }
};
