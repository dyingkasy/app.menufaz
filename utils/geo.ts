
import { Coordinates, SearchResult } from '../types';

export const GEO_API_ENABLED = true;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const toNumber = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeQuery = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const mapNominatimAddress = (address: any, displayName = ''): AddressComponents => {
  const street = address?.road || address?.pedestrian || address?.path || displayName.split(',')[0] || '';
  const number = address?.house_number || '';
  const district = address?.suburb || address?.neighbourhood || address?.quarter || '';
  const city = address?.city || address?.town || address?.village || address?.municipality || '';
  const state = address?.state || '';
  let fullText = street;
  if (number) fullText += `, ${number}`;
  if (district) fullText += ` - ${district}`;
  if (city) fullText += ` - ${city}`;
  if (!fullText.trim()) fullText = displayName;
  return { street, number, district, city, state, fullText };
};

const searchAddressFallback = async (query: string): Promise<SearchResult[]> => {
  const url = `${NOMINATIM_BASE_URL}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=br&q=${encodeURIComponent(
    query
  )}`;
  const response = await fetch(url, {
    headers: { 'Accept-Language': 'pt-BR' }
  });
  const data = await response.json();
  if (!Array.isArray(data)) return [];

  return data.map((item: any) => {
    const mapped = mapNominatimAddress(item.address, item.display_name || '');
    const lat = toNumber(item.lat);
    const lng = toNumber(item.lon);
    if (lat === null || lng === null) return null;
    return {
      street: mapped.street,
      district: mapped.district ? `${mapped.district}${mapped.city ? ` - ${mapped.city}` : ''}` : mapped.city,
      fullAddress: mapped.fullText,
      coordinates: {
        lat,
        lng
      },
      city: mapped.city,
      state: mapped.state
    };
  }).filter(Boolean) as SearchResult[];
};

const reverseGeocodeFallback = async (lat: number, lng: number): Promise<AddressComponents | null> => {
  const url = `${NOMINATIM_BASE_URL}/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lng)}`;
  const response = await fetch(url, {
    headers: { 'Accept-Language': 'pt-BR' }
  });
  const data = await response.json();
  if (!data || !data.address) return null;
  return mapNominatimAddress(data.address, data.display_name || '');
};

const searchAddressServer = async (query: string): Promise<SearchResult[]> => {
  if (!API_BASE_URL) return [];
  const response = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  return response.json();
};

const reverseGeocodeServer = async (lat: number, lng: number): Promise<AddressComponents | null> => {
  if (!API_BASE_URL) return null;
  const response = await fetch(
    `${API_BASE_URL}/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
  );
  if (!response.ok) return null;
  return response.json();
};

let googleMapsLoading: Promise<boolean> | null = null;
const GOOGLE_MAPS_CALLBACK = '__menufazGoogleMapsInit';

export const ensureGoogleMapsLoaded = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (window.google && window.google.maps) return true;
  if (!GOOGLE_MAPS_API_KEY) return false;
  if (!googleMapsLoading) {
    googleMapsLoading = new Promise((resolve) => {
      if (window.google && window.google.maps) {
        resolve(true);
        return;
      }

      const existing = document.querySelector<HTMLScriptElement>(
        'script[src*="maps.googleapis.com/maps/api/js"]'
      );
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
        return;
      }

      (window as any)[GOOGLE_MAPS_CALLBACK] = () => {
        resolve(true);
        delete (window as any)[GOOGLE_MAPS_CALLBACK];
      };

      const script = document.createElement('script');
      const params = new URLSearchParams({
        key: GOOGLE_MAPS_API_KEY,
        libraries: 'places',
        callback: GOOGLE_MAPS_CALLBACK,
        loading: 'async'
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.setAttribute('loading', 'async');
      script.onerror = () => {
        resolve(false);
        delete (window as any)[GOOGLE_MAPS_CALLBACK];
      };
      document.head.appendChild(script);
    });
  }
  return googleMapsLoading;
};

// Haversine formula to calculate distance between two coords in KM
export function calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(coord2.lat - coord1.lat);
  const dLon = deg2rad(coord2.lng - coord1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(coord1.lat)) * Math.cos(deg2rad(coord2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Obtém a localização atual usando a API do navegador.
 * Implementa retry com baixa precisão se a alta precisão falhar.
 */
export async function getCurrentLocation(): Promise<Coordinates> {
    if (!GEO_API_ENABLED) {
        return Promise.reject(new Error('Geolocalização desativada temporariamente.'));
    }

    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            return reject(new Error('Geolocalização não suportada pelo navegador.'));
        }

        const handleSuccess = (pos: GeolocationPosition) => {
            resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            });
        };

        const handleError = (err: GeolocationPositionError) => {
             // Se o usuário negou explicitamente, não adianta tentar de novo
             if (err.code === err.PERMISSION_DENIED) {
                 return reject(new Error('Permissão de localização negada.'));
             }

             console.warn('Tentando baixa precisão (cache/wifi)...', err.message);
             
             // Fallback: Tenta novamente com menor precisão e maior timeout
             navigator.geolocation.getCurrentPosition(
                 handleSuccess,
                 (errFinal) => {
                     // Se falhar de novo, rejeita com o erro original ou o novo
                     reject(new Error(`Não foi possível obter localização: ${errFinal.message}`));
                 },
                 { 
                     enableHighAccuracy: false, 
                     timeout: 20000, // 20 segundos para fallback
                     maximumAge: Infinity // Aceita qualquer posição em cache
                 }
             );
        };

        // Primeira tentativa: Alta precisão, cache recente (5 min)
        navigator.geolocation.getCurrentPosition(
            handleSuccess,
            handleError,
            {
                enableHighAccuracy: true,
                timeout: 10000, // 10 segundos para tentar GPS
                maximumAge: 300000 // Aceita cache de até 5 minutos
            }
        );
    });
}

/**
 * Interface detalhada do endereço
 */
export interface AddressComponents {
    street: string;
    number: string;
    district: string;
    city: string;
    state: string;
    fullText: string;
}

/**
 * Busca dados precisos de endereço via CEP (Brasil)
 */
export async function fetchCepData(cep: string): Promise<AddressComponents | null> {
    if (!GEO_API_ENABLED) return null;

    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) return null;

    try {
        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await response.json();
        
        if (data.erro) return null;

        return {
            street: data.logradouro,
            district: data.bairro,
            city: data.localidade,
            state: data.uf,
            number: '',
            fullText: `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`
        };
    } catch (error) {
        console.error("Erro ao buscar CEP:", error);
        return null;
    }
}

/**
 * Usa o Google Geocoder para converter Lat/Lng em endereço legível e estruturado.
 */
export async function getReverseGeocoding(lat: number, lng: number): Promise<AddressComponents | null> {
    if (!GEO_API_ENABLED) return null;

    if (!window.google || !window.google.maps) {
        await ensureGoogleMapsLoaded();
    }

    if (!window.google || !window.google.maps) {
        try {
            const serverResult = await reverseGeocodeServer(lat, lng);
            if (serverResult) return serverResult;
            return await reverseGeocodeFallback(lat, lng);
        } catch (error) {
            console.error("Reverse geocoding fallback failed", error);
            return null;
        }
    }

    const geocoder = new window.google.maps.Geocoder();

    return new Promise((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === 'OK' && results && results.length > 0) {
                // Tenta encontrar o resultado mais específico do tipo "street_address" ou "route"
                // O results[0] as vezes é um "premise" ou "plus_code" que não tem nome de rua
                // Iteramos para achar o melhor candidato que tenha RUA (route)
                const bestResult = results.find(r => 
                    r.types.includes('street_address') || 
                    r.types.includes('route') || 
                    r.types.includes('intersection')
                ) || results[0];
                
                let street = '';
                let number = '';
                let district = '';
                let city = '';
                let state = '';

                // Parse Address Components do Google
                bestResult.address_components.forEach(comp => {
                    if (comp.types.includes('route')) {
                        street = comp.long_name;
                    }
                    if (comp.types.includes('street_number')) {
                        number = comp.long_name;
                    }
                    if (comp.types.includes('sublocality') || comp.types.includes('sublocality_level_1')) {
                        district = comp.long_name;
                    }
                    if (comp.types.includes('administrative_area_level_2')) {
                        city = comp.long_name;
                    }
                    if (comp.types.includes('administrative_area_level_1')) {
                        state = comp.short_name;
                    }
                });

                // Fallback se não achar rua (ex: lugar remoto ou estabelecimento)
                if (!street && bestResult.formatted_address) {
                    street = bestResult.formatted_address.split(',')[0];
                }

                // Monta texto completo para exibição rápida
                let fullText = street;
                if (number) fullText += `, ${number}`;
                if (district) fullText += ` - ${district}`;
                if (city) fullText += ` - ${city}`;
                
                resolve({ street, number, district, city, state, fullText });
            } else {
                console.warn("Geocoder failed due to: " + status);
                resolve(null);
            }
        });
    });
}

/**
 * Usa o Google Geocoder para buscar um endereço por texto.
 */
export async function searchAddress(query: string): Promise<SearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    if (!GEO_API_ENABLED) {
        return [];
    }

    if (!window.google || !window.google.maps) {
        await ensureGoogleMapsLoaded();
    }

    if (!window.google || !window.google.maps) {
        try {
            const serverResults = await searchAddressServer(query);
            if (serverResults.length > 0) return serverResults;

            const fallbackQueries = [];
            const seen = new Set<string>();
            const addQuery = (value: string) => {
                const clean = value.trim();
                if (!clean) return;
                const key = clean.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                fallbackQueries.push(clean);
            };

            const normalizedQuery = normalizeQuery(query);
            addQuery(query);
            if (normalizedQuery && normalizedQuery !== query) addQuery(normalizedQuery);
            addQuery(`${query} Brasil`);
            if (normalizedQuery && normalizedQuery !== query) addQuery(`${normalizedQuery} Brasil`);

            const merged: SearchResult[] = [];
            const seenResult = new Set<string>();
            for (const fallbackQuery of fallbackQueries) {
                const results = await searchAddressFallback(fallbackQuery);
                for (const result of results) {
                    const key = `${result.coordinates.lat},${result.coordinates.lng},${result.fullAddress}`;
                    if (seenResult.has(key)) continue;
                    seenResult.add(key);
                    merged.push(result);
                    if (merged.length >= 6) break;
                }
                if (merged.length >= 6) break;
            }
            return merged;
        } catch (error) {
            console.error("Search fallback failed", error);
            return [];
        }
    }

    const geocoder = new window.google.maps.Geocoder();

    return new Promise((resolve) => {
        const request = {
            address: query,
            componentRestrictions: { country: 'BR' }
        };

        geocoder.geocode(request, (results, status) => {
            if (status === 'OK' && results) {
                const mappedResults: SearchResult[] = results.map(res => {
                    let street = '';
                    let district = '';
                    let city = '';
                    let state = '';

                    res.address_components.forEach(comp => {
                        if (comp.types.includes('route')) street = comp.long_name;
                        if (comp.types.includes('sublocality') || comp.types.includes('sublocality_level_1')) district = comp.long_name;
                        if (comp.types.includes('administrative_area_level_2')) city = comp.long_name;
                        if (comp.types.includes('administrative_area_level_1')) state = comp.short_name;
                    });

                    // Use formatted_address primarily as it is the most complete string
                    // But clean it up if possible to avoid country redundancy
                    let fullAddress = res.formatted_address;
                    
                    // Fallback logic for components
                    if (!street) {
                         const firstPart = fullAddress.split(',')[0];
                         if (isNaN(Number(firstPart)) && !firstPart.includes('Brasil')) {
                             street = firstPart;
                         } else {
                             street = fullAddress;
                         }
                    }

                    let displayDistrict = district || '';
                    if (city) displayDistrict += displayDistrict ? ` - ${city}` : city;
                    if (state) displayDistrict += `/${state}`;

                    return {
                        street: street,
                        district: displayDistrict,
                        fullAddress: fullAddress, 
                        coordinates: {
                            lat: res.geometry.location.lat(),
                            lng: res.geometry.location.lng()
                        },
                        city,
                        state
                    };
                });
                resolve(mappedResults);
            } else {
                resolve([]);
            }
        });
    });
}
