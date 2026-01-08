

import React, { useState, useEffect } from 'react';
import { ArrowLeft, User, Mail, Phone, MapPin, CreditCard, LogOut, Plus, Trash2, ShieldCheck, Home, Briefcase, Edit2, Loader2, Landmark, Save, X, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LocationModal from './LocationModal';
import { Address } from '../types';
import { addUserAddress, saveUserCard, getUserCards, deleteUserCard, EncryptedCard, updateUserProfile } from '../services/db';

interface ClientProfileProps {
    onBack: () => void;
    onLogout: () => void;
}

// --- Validation Helpers ---
const isValidCPF = (cpf: string) => {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
    let sum = 0;
    let remainder;
    for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(10, 11))) return false;
    return true;
};

const luhnCheck = (val: string) => {
    if (!val) return false;
    let checksum = 0;
    let j = 1;
    for (let i = val.length - 1; i >= 0; i--) {
        let calc = 0;
        calc = Number(val.charAt(i)) * j;
        if (calc > 9) {
            checksum = checksum + 1;
            calc = calc - 10;
        }
        checksum = checksum + calc;
        if (j == 1) j = 2;
        else j = 1;
    }
    return (checksum % 10) == 0;
};

const validateExpiry = (val: string) => {
    if (val.length !== 5) return false;
    const [month, year] = val.split('/').map(Number);
    if (!month || !year || month < 1 || month > 12) return false;
    
    const now = new Date();
    const currentYear = parseInt(now.getFullYear().toString().slice(-2));
    const currentMonth = now.getMonth() + 1;

    if (year < currentYear) return false;
    if (year === currentYear && month < currentMonth) return false;
    return true;
};

const getCardBrand = (number: string) => {
    const n = number.replace(/\D/g, '');
    if (n.match(/^4/)) return 'Visa';
    if (n.match(/^5[1-5]/)) return 'Mastercard';
    if (n.match(/^3[47]/)) return 'Amex';
    if (n.match(/^(606282|3841)/)) return 'Hipercard';
    if (n.match(/^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363|650|6516|6550)/)) return 'Elo';
    return 'Outro';
};

const ClientProfile: React.FC<ClientProfileProps> = ({ onBack, onLogout }) => {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'DATA' | 'ADDRESSES' | 'PAYMENT'>('DATA');
  
  // Address State
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // Data State
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
      name: '',
      phone: '',
      cpf: ''
  });
  const [cpfError, setCpfError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Payment State - CARTÕES REAIS
  const [savedCards, setSavedCards] = useState<EncryptedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCard, setNewCard] = useState({ number: '', name: '', expiry: '', cvv: '' });
  const [savingCard, setSavingCard] = useState(false);
  const [cardErrors, setCardErrors] = useState({ number: '', expiry: '', cvv: '' });

  // Initialize Form Data
  useEffect(() => {
      if (user) {
          setFormData({
              name: user.name || '',
              phone: user.phone || '',
              cpf: (user as any).cpf || ''
          });
      }
  }, [user]);

  const displayName = user?.name?.trim() || user?.email || 'Cliente';
  const displayEmail = user?.email || '';
  const displayInitial = displayName.charAt(0).toUpperCase();

  // Carregar cartões reais ao entrar na aba ou montar
  useEffect(() => {
      if (user && activeTab === 'PAYMENT') {
          loadCards();
      }
  }, [user, activeTab]);

  const loadCards = async () => {
      if (!user) return;
      setLoadingCards(true);
      try {
          const cards = await getUserCards(user.uid);
          setSavedCards(cards);
      } catch (e) {
          console.error("Erro ao carregar cartões", e);
      } finally {
          setLoadingCards(false);
      }
  };

  const handleDeleteCard = async (id: string) => {
    if (!user) return;
    if (confirm('Remover este cartão? Esta ação não pode ser desfeita.')) {
        try {
            setLoadingCards(true); // Show loading state while deleting
            await deleteUserCard(user.uid, id);
            
            // Force fetch fresh data to ensure state consistency
            await loadCards();
        } catch (e) {
            console.error("Error deleting card:", e);
            alert("Erro ao remover cartão.");
            // Revert to known state if error
            loadCards();
        } finally {
            setLoadingCards(false);
        }
    }
  };

  const handleSaveProfile = async () => {
      if (!user) return;
      setCpfError('');

      // Validação do CPF
      if (formData.cpf && !isValidCPF(formData.cpf)) {
          setCpfError('CPF inválido. Verifique os números digitados.');
          return;
      }

      if (!formData.name.trim()) {
          alert("Nome é obrigatório.");
          return;
      }

      setIsSavingProfile(true);
      try {
          await updateUserProfile(user.uid, { 
              name: formData.name,
              phone: formData.phone,
              cpf: formData.cpf 
          });
          await refreshUser();
          setIsEditing(false);
          alert("Dados atualizados com sucesso!");
      } catch (e) {
          alert("Erro ao atualizar perfil.");
      } finally {
          setIsSavingProfile(false);
      }
  };

  const handleSaveCard = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) return;
      
      setCardErrors({ number: '', expiry: '', cvv: '' });
      let hasError = false;

      const cleanNumber = newCard.number.replace(/\D/g, '');
      
      if (cleanNumber.length < 13 || !luhnCheck(cleanNumber)) {
          setCardErrors(prev => ({ ...prev, number: 'Número de cartão inválido.' }));
          hasError = true;
      }

      if (!validateExpiry(newCard.expiry)) {
          setCardErrors(prev => ({ ...prev, expiry: 'Data inválida ou vencida.' }));
          hasError = true;
      }

      if (newCard.cvv.length < 3) {
          setCardErrors(prev => ({ ...prev, cvv: 'CVV inválido.' }));
          hasError = true;
      }

      if (hasError) return;

      setSavingCard(true);
      try {
          const brand = getCardBrand(cleanNumber);
          await saveUserCard(user.uid, { ...newCard, number: cleanNumber, brand });
          await loadCards(); // Recarrega a lista
          setShowAddCard(false);
          setNewCard({ number: '', name: '', expiry: '', cvv: '' });
          alert("Cartão verificado e salvo com segurança!");
      } catch (e) {
          console.error(e);
          alert("Erro ao salvar cartão.");
      } finally {
          setSavingCard(false);
      }
  };

  const handleSaveNewAddress = async (newAddress: Address) => {
      if (!user) return;
      
      setIsSavingAddress(true);
      try {
          await addUserAddress(user.uid, newAddress);
          await refreshUser();
          setIsAddressModalOpen(false);
      } catch (error) {
          console.error("Erro ao salvar endereço:", error);
          alert("Erro ao salvar endereço. Tente novamente.");
      } finally {
          setIsSavingAddress(false);
      }
  };

  if (!user) return null;

  // Card Style Helpers
  const getCardStyle = (brand: string) => {
      switch(brand) {
          case 'Visa': return 'from-blue-700 to-blue-900';
          case 'Mastercard': return 'from-orange-700 to-red-900';
          case 'Amex': return 'from-slate-700 to-slate-900';
          case 'Elo': return 'from-yellow-600 to-orange-700';
          case 'Hipercard': return 'from-red-700 to-red-900';
          default: return 'from-slate-700 to-slate-900';
      }
  };

  const renderContent = () => {
      switch(activeTab) {
          case 'DATA':
              return (
                  <div className="space-y-6 animate-fade-in">
                      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-800">
                          <div className="flex justify-between items-center mb-6">
                              <h3 className="font-bold text-slate-800 dark:text-white text-lg">Dados Pessoais</h3>
                              {!isEditing ? (
                                  <button 
                                    onClick={() => setIsEditing(true)}
                                    className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2"
                                  >
                                      <Edit2 size={16} /> Editar Dados
                                  </button>
                              ) : (
                                  <button 
                                    onClick={() => {
                                        setIsEditing(false);
                                        // Reset data logic could go here
                                    }}
                                    className="text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
                                  >
                                      Cancelar
                                  </button>
                              )}
                          </div>
                          <div className="space-y-6">
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Nome Completo</label>
                                  <div className="relative">
                                      <input 
                                          type="text" 
                                          value={formData.name}
                                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                                          disabled={!isEditing}
                                          className={`w-full pl-10 pr-4 py-3 rounded-lg border ${!isEditing ? 'bg-gray-50 dark:bg-slate-900/50 border-transparent' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-red-500'} dark:text-white outline-none transition-all`}
                                      />
                                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                  </div>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">E-mail</label>
                                  <div className="relative">
                                      <input 
                                          type="text" 
                                          value={user.email}
                                          disabled={true} // Email cannot be changed simply
                                          className="w-full pl-10 pr-4 py-3 rounded-lg border bg-gray-50 dark:bg-slate-900/50 border-transparent dark:text-gray-400 cursor-not-allowed"
                                      />
                                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                  </div>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Celular</label>
                                  <div className="relative">
                                      <input 
                                          type="tel" 
                                          value={formData.phone}
                                          onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                          disabled={!isEditing}
                                          placeholder="(00) 00000-0000"
                                          className={`w-full pl-10 pr-4 py-3 rounded-lg border ${!isEditing ? 'bg-gray-50 dark:bg-slate-900/50 border-transparent' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-red-500'} dark:text-white outline-none transition-all`}
                                      />
                                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                  </div>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">CPF (Opcional)</label>
                                  <div className="relative">
                                      <input 
                                          type="text" 
                                          value={formData.cpf}
                                          onChange={(e) => {
                                              setCpfError('');
                                              // Mascara simples
                                              let v = e.target.value.replace(/\D/g, '');
                                              if(v.length > 11) v = v.slice(0, 11);
                                              v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                              v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                              v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                                              setFormData({...formData, cpf: v});
                                          }}
                                          disabled={!isEditing}
                                          placeholder="000.000.000-00"
                                          className={`w-full pl-10 pr-4 py-3 rounded-lg border ${cpfError ? 'border-red-500 focus:ring-red-200' : !isEditing ? 'bg-gray-50 dark:bg-slate-900/50 border-transparent' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-red-500'} dark:text-white outline-none transition-all`}
                                      />
                                      <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                  </div>
                                  {cpfError && <p className="text-xs text-red-600 mt-1 font-bold">{cpfError}</p>}
                              </div>
                              
                              {isEditing && (
                                  <div className="flex gap-3 pt-4">
                                      <button 
                                        onClick={handleSaveProfile}
                                        disabled={isSavingProfile}
                                        className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                                      >
                                          {isSavingProfile ? <Loader2 className="animate-spin" size={18}/> : <Save size={18} />}
                                          Salvar Alterações
                                      </button>
                                  </div>
                              )}
                          </div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl flex gap-3 border border-blue-100 dark:border-blue-800 items-start">
                          <ShieldCheck className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                          <div>
                              <p className="font-bold text-blue-800 dark:text-blue-300 text-sm">Conta Verificada e Segura</p>
                              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 leading-relaxed">
                                  Seus dados são criptografados e nunca compartilhados sem permissão.
                              </p>
                          </div>
                      </div>
                  </div>
              );
          case 'ADDRESSES':
              return (
                  <div className="space-y-4 animate-fade-in">
                      <button 
                          onClick={() => setIsAddressModalOpen(true)}
                          className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center text-gray-500 hover:border-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 transition-all gap-2 group"
                      >
                          <div className="w-10 h-10 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center group-hover:bg-red-100 transition-colors">
                              <Plus size={20} />
                          </div>
                          <span className="font-bold text-sm">Adicionar Novo Endereço</span>
                      </button>

                      {user.addresses && user.addresses.length > 0 ? (
                          user.addresses.map((addr) => (
                              <div key={addr.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between group hover:border-red-200 transition-colors">
                                  <div className="flex items-center gap-4">
                                      <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center justify-center text-red-600 dark:text-red-400">
                                          {addr.label === 'Casa' ? <Home size={22} /> : addr.label === 'Trabalho' ? <Briefcase size={22} /> : <MapPin size={22} />}
                                      </div>
                                      <div>
                                          <p className="font-bold text-slate-800 dark:text-white text-base">{addr.label}</p>
                                          <p className="text-sm text-gray-500 dark:text-gray-400">{addr.street}, {addr.number}</p>
                                          <p className="text-xs text-gray-400">{addr.district} - {addr.city}</p>
                                      </div>
                                  </div>
                                  <div className="flex gap-2">
                                      <button className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-slate-800"><Trash2 size={18} /></button>
                                  </div>
                              </div>
                          ))
                      ) : (
                          <p className="text-center text-gray-400 py-8">Nenhum endereço salvo.</p>
                      )}
                  </div>
              );
          case 'PAYMENT':
              return (
                  <div className="space-y-6 animate-fade-in">
                       {/* Saved Cards List */}
                       <div className="space-y-4">
                           {loadingCards ? (
                               <div className="flex justify-center py-10"><Loader2 className="animate-spin text-red-600" /></div>
                           ) : savedCards.length === 0 && !showAddCard ? (
                               <div className="text-center py-8 text-gray-400 border border-dashed border-gray-300 dark:border-slate-700 rounded-2xl">
                                   <CreditCard size={32} className="mx-auto mb-2 opacity-50"/>
                                   <p>Nenhum cartão salvo.</p>
                               </div>
                           ) : (
                               savedCards.map(card => (
                                   <div key={card.id} className={`bg-gradient-to-br ${getCardStyle(card.brand)} text-white p-6 rounded-2xl shadow-xl relative overflow-hidden group transform hover:scale-[1.02] transition-transform`}>
                                       <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                                           <CreditCard size={120} />
                                       </div>
                                       <div className="relative z-10">
                                           <div className="flex justify-between items-start mb-8">
                                               <div className="flex items-center gap-2">
                                                   {/* Mock Icon based on Brand */}
                                                   <span className="font-bold uppercase tracking-wider text-sm bg-white/20 px-2 py-1 rounded">{card.brand}</span>
                                               </div>
                                               <button 
                                                    onClick={() => handleDeleteCard(card.id)} 
                                                    className="text-white/60 hover:text-white hover:bg-red-500/50 transition-colors p-2 rounded-full backdrop-blur-sm"
                                                    title="Excluir Cartão"
                                               >
                                                   <Trash2 size={16} />
                                               </button>
                                           </div>
                                           <div className="font-mono text-xl md:text-2xl tracking-widest mb-4 drop-shadow-md flex items-center gap-2">
                                               <span className="text-[10px] align-middle tracking-normal opacity-60 mr-2">••••</span>
                                               <span className="text-[10px] align-middle tracking-normal opacity-60 mr-2">••••</span>
                                               <span className="text-[10px] align-middle tracking-normal opacity-60 mr-2">••••</span>
                                               {card.last4}
                                           </div>
                                           <div className="flex justify-between items-end">
                                               <div>
                                                   <p className="text-[10px] text-white/60 uppercase font-bold mb-1">Titular</p>
                                                   <p className="font-bold text-xs md:text-sm uppercase tracking-wide truncate max-w-[150px]">{card.holder}</p>
                                               </div>
                                               <div className="text-right">
                                                    <p className="text-[10px] text-white/60 uppercase font-bold mb-1">Validade</p>
                                                    <p className="font-mono text-xs md:text-sm">{card.expiry}</p>
                                               </div>
                                           </div>
                                       </div>
                                   </div>
                               ))
                           )}
                       </div>

                       {/* Add Card Form Toggle */}
                       {!showAddCard ? (
                           <button 
                              onClick={() => setShowAddCard(true)}
                              className="w-full py-4 bg-white dark:bg-slate-900 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl flex items-center justify-center gap-2 text-gray-500 hover:text-red-600 hover:border-red-500 hover:bg-red-50 dark:hover:bg-slate-800 transition-all font-bold"
                           >
                              <Plus size={20} /> Adicionar Cartão
                           </button>
                       ) : (
                           <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-slate-800 animate-slide-up">
                               <div className="flex justify-between items-center mb-4">
                                   <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                                       <ShieldCheck className="text-green-600" size={20} /> Novo Cartão Seguro
                                   </h3>
                                   <button onClick={() => setShowAddCard(false)} className="text-gray-400 hover:text-red-500"><X size={20}/></button>
                               </div>
                               <form onSubmit={handleSaveCard} className="space-y-4">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número do Cartão</label>
                                       <input 
                                            type="text" 
                                            placeholder="0000 0000 0000 0000" 
                                            maxLength={23}
                                            value={newCard.number}
                                            onChange={e => {
                                                setCardErrors(prev => ({...prev, number: ''}));
                                                const v = e.target.value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
                                                setNewCard({...newCard, number: v.slice(0, 23)});
                                            }}
                                            className={`w-full p-3 border rounded-xl bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 font-mono transition-all ${cardErrors.number ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-700 focus:ring-red-500'}`}
                                       />
                                       {cardErrors.number && <p className="text-xs text-red-600 mt-1 font-bold">{cardErrors.number}</p>}
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome no Cartão</label>
                                       <input 
                                            type="text" 
                                            placeholder="COMO NO CARTAO" 
                                            value={newCard.name}
                                            onChange={e => setNewCard({...newCard, name: e.target.value})}
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-red-500 dark:text-white uppercase"
                                       />
                                   </div>
                                   <div className="grid grid-cols-2 gap-4">
                                       <div>
                                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Validade</label>
                                           <input 
                                                type="text" 
                                                placeholder="MM/AA" 
                                                maxLength={5}
                                                value={newCard.expiry}
                                                onChange={e => {
                                                    setCardErrors(prev => ({...prev, expiry: ''}));
                                                    let val = e.target.value.replace(/\D/g, '');
                                                    if (val.length >= 2) val = val.slice(0,2) + '/' + val.slice(2,4);
                                                    setNewCard({...newCard, expiry: val});
                                                }}
                                                className={`w-full p-3 border rounded-xl bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 text-center transition-all ${cardErrors.expiry ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-700 focus:ring-red-500'}`}
                                           />
                                           {cardErrors.expiry && <p className="text-xs text-red-600 mt-1 font-bold">{cardErrors.expiry}</p>}
                                       </div>
                                       <div>
                                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CVV</label>
                                           <input 
                                                type="text" 
                                                placeholder="123" 
                                                maxLength={4}
                                                value={newCard.cvv}
                                                onChange={e => {
                                                    setCardErrors(prev => ({...prev, cvv: ''}));
                                                    setNewCard({...newCard, cvv: e.target.value.replace(/\D/g, '')})
                                                }}
                                                className={`w-full p-3 border rounded-xl bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 text-center transition-all ${cardErrors.cvv ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-700 focus:ring-red-500'}`}
                                           />
                                           {cardErrors.cvv && <p className="text-xs text-red-600 mt-1 font-bold">{cardErrors.cvv}</p>}
                                       </div>
                                   </div>
                                   
                                   <div className="text-[10px] text-gray-400 flex items-center gap-1 bg-gray-50 dark:bg-slate-800 p-2 rounded">
                                       <ShieldCheck size={12} /> Seus dados são criptografados antes de serem salvos.
                                   </div>

                                   <div className="flex gap-3 pt-2">
                                       <button 
                                            type="button" 
                                            onClick={() => setShowAddCard(false)}
                                            className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl"
                                            disabled={savingCard}
                                       >
                                           Cancelar
                                       </button>
                                       <button 
                                            type="submit"
                                            className="flex-1 py-3 bg-slate-900 dark:bg-red-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-70"
                                            disabled={savingCard}
                                       >
                                           {savingCard ? <Loader2 className="animate-spin" size={18} /> : 'Salvar Cartão'}
                                       </button>
                                   </div>
                               </form>
                           </div>
                       )}
                  </div>
              );
      }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-sans">
      <header className="bg-white dark:bg-slate-900 sticky top-0 z-30 border-b border-gray-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
            >
              <ArrowLeft className="text-slate-700 dark:text-white" />
            </button>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Meu Perfil</h1>
          </div>
          <button 
            onClick={onLogout}
            className="text-red-600 font-bold text-sm flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors"
          >
              <LogOut size={16} /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
          {/* Profile Hero */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-3xl p-8 mb-8 shadow-xl text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
              <div className="flex items-center gap-6 relative z-10">
                  <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-slate-900 text-3xl font-bold border-4 border-white/20 shadow-md">
                      {displayInitial}
                  </div>
                  <div>
                      <h2 className="text-2xl font-bold">{displayName}</h2>
                      <p className="text-slate-300 text-sm mb-2">{displayEmail}</p>
                      <div className="inline-flex items-center gap-1 px-3 py-1 bg-white/10 rounded-full text-xs font-bold backdrop-blur-sm border border-white/10">
                          <User size={12} /> Cliente VIP
                      </div>
                  </div>
              </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl mb-8 border border-gray-100 dark:border-slate-800 shadow-sm">
              {[
                  { id: 'DATA', label: 'Dados', icon: User },
                  { id: 'ADDRESSES', label: 'Endereços', icon: MapPin },
                  { id: 'PAYMENT', label: 'Cartões', icon: CreditCard }
              ].map(tab => (
                  <button 
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeTab === tab.id ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}
                  >
                      <tab.icon size={16} /> {tab.label}
                  </button>
              ))}
          </div>

          {/* Content Area */}
          <div className="min-h-[300px]">
              {renderContent()}
          </div>
      </main>

      {/* Location Modal for Adding Address */}
      {isAddressModalOpen && (
          <div className="fixed inset-0 z-[100]">
            {isSavingAddress && (
                <div className="absolute inset-0 z-[110] bg-white/80 dark:bg-slate-900/80 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-red-600" size={40} />
                        <p className="font-bold text-slate-800 dark:text-white">Salvando endereço...</p>
                    </div>
                </div>
            )}
            <LocationModal 
                isOpen={isAddressModalOpen}
                onClose={() => setIsAddressModalOpen(false)}
                onSelectAddress={() => {}} 
                onSaveAddress={handleSaveNewAddress}
                savedAddresses={user.addresses || []}
                canClose={true}
            />
          </div>
      )}
    </div>
  );
};

export default ClientProfile;
