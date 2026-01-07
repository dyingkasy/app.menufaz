
import { Coordinates, SearchResult } from '../types';

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
    if (!window.google || !window.google.maps) {
        console.error("Google Maps API not loaded");
        return null;
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
    if (!window.google || !window.google.maps) return [];

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
