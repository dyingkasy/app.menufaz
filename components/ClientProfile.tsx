

import React, { useState, useEffect } from 'react';
import { ArrowLeft, User, Mail, Phone, MapPin, LogOut, Plus, Trash2, ShieldCheck, Home, Briefcase, Edit2, Loader2, Landmark, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LocationModal from './LocationModal';
import { Address } from '../types';
import { addUserAddress, updateUserProfile } from '../services/db';

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


const ClientProfile: React.FC<ClientProfileProps> = ({ onBack, onLogout }) => {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'DATA' | 'ADDRESSES'>('DATA');
  
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

  const safeName = typeof user?.name === 'string' ? user.name.trim() : '';
  const safeEmail = typeof user?.email === 'string' ? user.email : '';
  const displayName = safeName || safeEmail || 'Cliente';
  const displayEmail = safeEmail;
  const displayInitial = displayName ? displayName.charAt(0).toUpperCase() : 'C';
  const addressCount = user?.addresses?.length || 0;
  const profileScore = [
      Boolean(formData.name?.trim()),
      Boolean(formData.phone?.trim()),
      addressCount > 0
  ].filter(Boolean).length;
  const profileCompletion = Math.round((profileScore / 3) * 100);
  const profileLabel = profileCompletion >= 100 ? 'Completo' : profileCompletion >= 67 ? 'Quase pronto' : 'Incompleto';

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
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      <header className="bg-white/90 dark:bg-slate-900/90 sticky top-0 z-30 border-b border-gray-200/80 dark:border-slate-800 shadow-sm backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-4 py-8">
          {/* Profile Hero */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-red-50/60 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 mb-8 shadow-sm">
              <div className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full bg-red-200/40 blur-3xl dark:bg-red-900/20" />
              <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-orange-200/30 blur-3xl dark:bg-orange-900/20" />
              <div className="relative grid gap-6 md:grid-cols-[1.2fr,0.8fr]">
                  <div className="flex items-center gap-6">
                      <div className="w-20 h-20 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-3xl font-bold shadow-lg shadow-slate-900/20">
                          {displayInitial}
                      </div>
                      <div>
                          <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white">
                                  {displayName}
                              </h2>
                              <span className="text-xs font-bold uppercase tracking-[0.2em] text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full">
                                  Cliente
                              </span>
                          </div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{displayEmail}</p>
                          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                              <ShieldCheck size={14} className="text-green-600" />
                              Perfil seguro e protegido
                          </div>
                      </div>
                  </div>
                  <div className="grid gap-3">
                      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-4">
                          <p className="text-xs font-bold uppercase text-slate-400">Completo</p>
                          <div className="mt-2 flex items-center justify-between">
                              <span className="text-xl font-extrabold text-slate-900 dark:text-white">{profileCompletion}%</span>
                              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{profileLabel}</span>
                          </div>
                          <div className="mt-3 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-red-500" style={{ width: `${profileCompletion}%` }} />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-4">
                              <p className="text-xs font-bold uppercase text-slate-400">Enderecos</p>
                              <p className="mt-2 text-xl font-extrabold text-slate-900 dark:text-white">{addressCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-4">
                              <p className="text-xs font-bold uppercase text-slate-400">Status</p>
                              <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">Ativo</p>
                              <p className="text-xs text-slate-400">Conta liberada</p>
                          </div>
                      </div>
                  </div>
              </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-2xl mb-8 border border-gray-100 dark:border-slate-800 shadow-sm">
              {[
                  { id: 'DATA', label: 'Dados', icon: User },
                  { id: 'ADDRESSES', label: 'Endereços', icon: MapPin }
              ].map(tab => (
                  <button 
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                          activeTab === tab.id
                              ? 'bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 text-slate-900 dark:text-white shadow-sm border border-slate-200/70 dark:border-slate-700'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/50'
                      }`}
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
