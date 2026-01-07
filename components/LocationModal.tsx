
import React, { useState, useRef, useEffect } from 'react';
import { X, MapPin, Navigation, Search, Plus, Home, Briefcase, Check, Loader2, Tag, AlertCircle, ChevronLeft } from 'lucide-react';
import { Address, Coordinates, SearchResult } from '../types';
import { getReverseGeocoding, searchAddress, getCurrentLocation, fetchCepData } from '../utils/geo';

declare global {
  interface Window {
    google: any;
  }
}

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAddress: (address: Address) => void;
  onSaveAddress: (address: Address) => void;
  savedAddresses: Address[];
  canClose?: boolean;
}

type ModalStep = 'SEARCH' | 'CONFIRM_PIN';

const DEFAULT_COORDS = { lat: -23.561684, lng: -46.655981 }; // Av Paulista

const LocationModal: React.FC<LocationModalProps> = ({ 
    isOpen, 
    onClose, 
    onSelectAddress, 
    onSaveAddress, 
    savedAddresses,
    canClose = true 
}) => {
  const [step, setStep] = useState<ModalStep>('SEARCH');
  
  // Search State
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);

  // Map / Pin State
  const [mapCoordinates, setMapCoordinates] = useState<Coordinates>(DEFAULT_COORDS);
  const [isMapDragging, setIsMapDragging] = useState(false);
  const [isLoadingAddressDetails, setIsLoadingAddressDetails] = useState(false);
  
  // Address Details State
  const [addressStreet, setAddressStreet] = useState('');
  const [addressDistrict, setAddressDistrict] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [labelType, setLabelType] = useState<'Casa' | 'Trabalho' | 'Outro'>('Casa');
  const [customLabel, setCustomLabel] = useState('');
  
  // UI State
  const [numberError, setNumberError] = useState(false);

  // Google Maps Ref
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticMoveRef = useRef(false);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep('SEARCH');
      setSearchText('');
      setSearchResults([]);
      setNumberError(false);
    } else {
        // CLEANUP MAP INSTANCE ON CLOSE TO FIX "BLANK MAP" ISSUE
        mapRef.current = null;
    }
  }, [isOpen]);

  // --- SEARCH LOGIC ---

  useEffect(() => {
      const timer = setTimeout(async () => {
          if (searchText.length >= 8) {
              // Verifica se é CEP (XXXXX-XXX ou XXXXXXXX)
              const cleanSearch = searchText.replace(/\D/g, '');
              
              if (cleanSearch.length === 8) {
                  // É UM CEP: Busca dados precisos no ViaCEP
                  setIsSearching(true);
                  try {
                      const cepData = await fetchCepData(cleanSearch);
                      if (cepData) {
                          // Se achou o CEP, buscamos a coordenada disso no Google para o mapa
                          // Mas PRESERVAMOS os dados do ViaCEP que são mais precisos
                          const results = await searchAddress(cepData.fullText);
                          
                          // Prioriza dados do ViaCEP para texto, mas usa coords do Google
                          const enrichedResults: SearchResult[] = results.map(r => ({
                              ...r,
                              street: cepData.street, // Garante nome da rua correto do ViaCEP
                              district: cepData.district,
                              city: cepData.city,
                              state: cepData.state,
                              fullAddress: cepData.fullText
                          }));
                          
                          setSearchResults(enrichedResults);
                      } else {
                          // Fallback para busca normal se CEP falhar
                          const results = await searchAddress(searchText);
                          setSearchResults(results);
                      }
                  } catch (e) {
                      console.error(e);
                  } finally {
                      setIsSearching(false);
                  }
                  return;
              }
          }

          if (searchText.length > 3) {
              setIsSearching(true);
              try {
                  const results = await searchAddress(searchText);
                  setSearchResults(results);
              } catch (e) {
                  console.error(e);
              } finally {
                  setIsSearching(false);
              }
          } else {
              setSearchResults([]);
          }
      }, 800);
      return () => clearTimeout(timer);
  }, [searchText]);

  const handleUseGPS = async () => {
      setIsLocatingUser(true);
      try {
          const coords = await getCurrentLocation();
          setMapCoordinates(coords);
          
          // Força atualização dos detalhes do endereço baseado na nova coordenada
          await updateAddressFromCoords(coords);
          
          setStep('CONFIRM_PIN');
      } catch (error) {
          alert('Não foi possível obter sua localização. Verifique se o GPS está ativo.');
      } finally {
          setIsLocatingUser(false);
      }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
      setMapCoordinates(result.coordinates);
      setStep('CONFIRM_PIN');
      
      // Pre-fill inputs with high confidence data if available (e.g. from CEP)
      setAddressStreet(result.street);
      
      // Lógica aprimorada para extração de bairro e cidade
      if (result.district) {
          // As vezes vem "Bairro - Cidade", as vezes só "Bairro"
          const parts = result.district.split(' - ');
          setAddressDistrict(parts[0] || '');
          if (parts[1] && !result.city) setAddressCity(parts[1]); // Usa do split se city estiver vazia
          else if (result.city) setAddressCity(result.city);
      } else if (result.city) {
          setAddressCity(result.city);
      }
      
      if (result.state) setAddressState(result.state);
      
      // Resetar número ao selecionar novo endereço da busca (pois busca geralmente não tem número exato)
      setStreetNumber(''); 
  };

  // --- MAP LOGIC ---

  // Init Map
  useEffect(() => {
      // Delay map initialization slightly to ensure DOM is ready
      if (isOpen && step === 'CONFIRM_PIN' && mapContainerRef.current) {
          if (!window.google) return;

          // Se já existe, não recria, mas garante resize
          if (mapRef.current) {
              window.google.maps.event.trigger(mapRef.current, 'resize');
              mapRef.current.setCenter(mapCoordinates);
              return;
          }

          const map = new window.google.maps.Map(mapContainerRef.current, {
              center: mapCoordinates,
              zoom: 18,
              disableDefaultUI: true,
              zoomControl: false,
              clickableIcons: false,
              gestureHandling: 'greedy'
          });

          mapRef.current = map;

          map.addListener('dragstart', () => setIsMapDragging(true));
          map.addListener('dragend', () => setIsMapDragging(false));
          
          map.addListener('idle', () => {
              setIsMapDragging(false);
              if (isProgrammaticMoveRef.current) {
                  isProgrammaticMoveRef.current = false;
                  return;
              }
              const center = map.getCenter();
              // Only update if changed significantly to prevent loops
              setMapCoordinates(prev => {
                  if (Math.abs(prev.lat - center.lat()) < 0.00001 && Math.abs(prev.lng - center.lng()) < 0.00001) {
                      return prev;
                  }
                  const newCoords = { lat: center.lat(), lng: center.lng() };
                  // Update address details when map settles by user drag
                  updateAddressFromCoords(newCoords);
                  return newCoords;
              });
          });
      }
  }, [isOpen, step]); // Remove mapCoordinates dep to avoid recreation loop

  // Sync Map with Coordinates State (Programmatic Move)
  useEffect(() => {
      if (isOpen && step === 'CONFIRM_PIN' && mapRef.current) {
          const currentCenter = mapRef.current.getCenter();
          const diff = Math.abs(currentCenter.lat() - mapCoordinates.lat) + Math.abs(currentCenter.lng() - mapCoordinates.lng);
          
          if (diff > 0.0001) {
              isProgrammaticMoveRef.current = true;
              mapRef.current.panTo(mapCoordinates);
          }
      }
  }, [mapCoordinates, isOpen, step]);

  const updateAddressFromCoords = async (coords: Coordinates) => {
      setIsLoadingAddressDetails(true);
      try {
          const data = await getReverseGeocoding(coords.lat, coords.lng);
          
          if (data) {
              setAddressStreet(data.street || 'Rua sem nome');
              setAddressDistrict(data.district);
              setAddressCity(data.city);
              setAddressState(data.state);
              // Não sobrescreve número se o usuário já digitou, a menos que venha vazio
              // Se veio do GPS, o número costuma ser aproximado, então é bom preencher mas deixar editar
              if (data.number) setStreetNumber(data.number);
              setNumberError(false);
          } else {
              setAddressStreet('Endereço não identificado');
              setAddressDistrict('');
              setAddressCity('');
              setAddressState('');
          }
      } catch (e) {
          console.error(e);
      } finally {
          setIsLoadingAddressDetails(false);
      }
  };

  const handleConfirm = (e: React.MouseEvent) => {
      e.preventDefault(); // Stop form submission
      e.stopPropagation();

      // Simple Validation
      if (!streetNumber.trim()) {
          setNumberError(true);
          const numberInput = document.getElementById('street-number-input');
          if (numberInput) numberInput.focus();
          return;
      }

      const finalLabel = labelType === 'Outro' ? (customLabel || 'Outro') : labelType;
      
      const newAddress: Address = {
          id: Date.now().toString(),
          label: finalLabel,
          street: addressStreet,
          number: streetNumber,
          coordinates: mapCoordinates,
          city: addressCity,
          state: addressState,
          district: addressDistrict
      };

      onSaveAddress(newAddress);
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center">
        {/* Overlay */}
        <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
            onClick={canClose ? onClose : undefined} 
        />

        <div className="relative bg-white dark:bg-slate-900 w-full md:w-[480px] md:rounded-2xl rounded-t-3xl shadow-2xl flex flex-col h-[90vh] md:h-[700px] overflow-hidden animate-slide-up z-10">
            
            {/* HEADER */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 z-20">
                <div className="flex items-center gap-2">
                    {step === 'CONFIRM_PIN' && (
                        <button onClick={() => setStep('SEARCH')} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full">
                            <ChevronLeft size={24} className="text-gray-600 dark:text-gray-300" />
                        </button>
                    )}
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                        {step === 'SEARCH' ? 'Onde vamos entregar?' : 'Confirmar Localização'}
                    </h3>
                </div>
                
                {canClose && (
                    <button onClick={onClose} className="p-2 bg-gray-100 dark:bg-slate-800 rounded-full text-gray-500 hover:text-red-600 transition-colors">
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* CONTENT */}
            {step === 'SEARCH' ? (
                <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-950 p-4">
                    {!canClose && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/50 p-3 rounded-lg mb-4 flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                            <AlertCircle size={18} />
                            <span>Para continuar, precisamos saber sua localização.</span>
                        </div>
                    )}

                    {/* Search Input */}
                    <div className="relative mb-4">
                        <input 
                            type="text" 
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="Digite CEP ou Endereço" 
                            className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl py-3.5 pl-11 pr-4 text-gray-800 dark:text-white shadow-sm focus:ring-2 focus:ring-red-500 outline-none"
                            autoFocus
                        />
                        <Search className="absolute left-4 top-3.5 text-gray-400" size={20} />
                        {isSearching && <Loader2 className="absolute right-4 top-3.5 text-red-500 animate-spin" size={20} />}
                    </div>

                    {/* Search Results List */}
                    {searchResults.length > 0 ? (
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden mb-6">
                            {searchResults.map((res, idx) => (
                                <button 
                                    key={idx}
                                    onClick={() => handleSelectSearchResult(res)}
                                    className="w-full flex items-start gap-3 p-4 hover:bg-red-50 dark:hover:bg-slate-700 border-b border-gray-100 dark:border-slate-700 last:border-0 text-left transition-colors"
                                >
                                    <div className="mt-1 text-gray-400"><MapPin size={18} /></div>
                                    <div className="flex-1">
                                        <p className="font-bold text-gray-800 dark:text-white text-sm leading-tight mb-0.5">{res.street || res.fullAddress}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {res.district}{res.city ? ` - ${res.city}` : ''}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {/* GPS Button */}
                    <button 
                        onClick={handleUseGPS}
                        disabled={isLocatingUser}
                        className="w-full flex items-center gap-3 p-4 mb-6 bg-white dark:bg-slate-900 border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-slate-800 transition-all shadow-sm"
                    >
                        <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                            {isLocatingUser ? <Loader2 className="animate-spin" size={20}/> : <Navigation size={20} className="fill-current" />}
                        </div>
                        <div className="text-left">
                            <p className="font-bold text-sm">Usar localização atual</p>
                            <p className="text-xs opacity-80">Ativar GPS</p>
                        </div>
                    </button>

                    {/* Saved Addresses */}
                    <div className="space-y-3">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">Endereços Salvos</p>
                        {savedAddresses.map(addr => (
                            <button 
                                key={addr.id}
                                onClick={() => { onSelectAddress(addr); onSaveAddress(addr); }}
                                className="w-full flex items-start gap-3 p-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl hover:border-red-200 dark:hover:border-slate-600 transition-all text-left shadow-sm"
                            >
                                <div className="mt-1 text-gray-400">
                                    {addr.label === 'Casa' ? <Home size={18} /> : addr.label === 'Trabalho' ? <Briefcase size={18} /> : <MapPin size={18} />}
                                </div>
                                <div>
                                    <p className="font-bold text-gray-800 dark:text-white text-sm">{addr.label}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{addr.street}, {addr.number}</p>
                                </div>
                            </button>
                        ))}
                        {savedAddresses.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-4 italic">Nenhum endereço salvo.</p>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col h-full relative bg-slate-100 dark:bg-slate-950">
                    {/* Map */}
                    <div className="relative w-full flex-grow min-h-[300px]">
                        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
                        
                        {/* Center Pin */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none -mt-8 flex flex-col items-center">
                            <div className={`bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg mb-1 transition-opacity ${isMapDragging ? 'opacity-0' : 'opacity-100'}`}>
                                {isLoadingAddressDetails ? 'Carregando...' : 'É aqui?'}
                            </div>
                            <MapPin size={48} className="text-red-600 fill-red-600 drop-shadow-2xl" />
                            <div className="w-2 h-1 bg-black/20 rounded-full blur-[1px]"></div>
                        </div>
                    </div>

                    {/* Address Form Sheet */}
                    <div className="bg-white dark:bg-slate-900 rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] p-5 z-20 relative -mt-4">
                        <div className="w-12 h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full mx-auto mb-4"></div>
                        
                        <div className="mb-4">
                            <div className="flex gap-3 items-start">
                                <MapPin className="text-red-600 mt-1 shrink-0" size={20} />
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white text-lg leading-tight">
                                        {addressStreet || 'Rua desconhecida'}
                                    </h4>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{addressDistrict}{addressCity ? ` - ${addressCity}` : ''}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mb-4">
                            <div className="w-28 shrink-0">
                                <label className={`text-[10px] font-bold uppercase mb-1 block ${numberError ? 'text-red-600' : 'text-gray-400'}`}>Número *</label>
                                <input 
                                    id="street-number-input"
                                    type="text" 
                                    value={streetNumber}
                                    onChange={(e) => {
                                        setStreetNumber(e.target.value);
                                        if (e.target.value) setNumberError(false);
                                    }}
                                    placeholder="Nº"
                                    className={`w-full bg-gray-50 dark:bg-slate-800 border rounded-lg p-3 text-center font-bold text-slate-900 dark:text-white focus:ring-2 outline-none transition-all ${numberError ? 'border-red-500 ring-red-100 focus:ring-red-500 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-slate-700 focus:ring-red-500'}`}
                                />
                                {numberError && <span className="text-[10px] text-red-500 font-bold mt-1 block">Obrigatório</span>}
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Complemento</label>
                                <input 
                                    type="text" 
                                    value={complement}
                                    onChange={(e) => setComplement(e.target.value)}
                                    placeholder="Apto, Bloco..."
                                    className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                                />
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">Salvar como</label>
                            <div className="flex gap-2">
                                {(['Casa', 'Trabalho', 'Outro'] as const).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setLabelType(type)}
                                        type="button"
                                        className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors ${labelType === type ? 'bg-red-600 text-white border-red-600' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'}`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                            {labelType === 'Outro' && (
                                <input 
                                    type="text"
                                    value={customLabel}
                                    onChange={(e) => setCustomLabel(e.target.value)}
                                    placeholder="Nome do local (ex: Casa da Namorada)"
                                    className="mt-2 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-sm focus:ring-red-500 outline-none dark:text-white"
                                />
                            )}
                        </div>

                        <button 
                            onClick={handleConfirm}
                            type="button" 
                            disabled={isLoadingAddressDetails}
                            className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isLoadingAddressDetails ? <Loader2 className="animate-spin" /> : <Check size={20} />}
                            Confirmar Endereço
                        </button>
                    </div>
                </div>
            )}

        </div>
    </div>
  );
};

export default LocationModal;
