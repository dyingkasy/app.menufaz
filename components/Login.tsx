
import React, { useState, useRef } from 'react';
import { User, Building2, ArrowLeft, ShoppingBag, Mail, Lock, Phone, CheckCircle, MapPin, Hash, Globe, Home, Send, KeyRound, Loader2, LogIn, Bike } from 'lucide-react';
import { ViewState, UserRole, Address } from '../types';
import { createUserProfile } from '../services/db';
import { AuthUser, login, register, sendPasswordResetEmail, setAuthUser } from '../services/auth';

interface LoginProps {
    onNavigate: (view: ViewState) => void;
    onLoginSuccess: (role: UserRole, name?: string, address?: Address) => void;
}

type LoginViewMode = 'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD' | 'RESET_PASSWORD' | 'RESET_SUCCESS';

const Login: React.FC<LoginProps> = ({ onNavigate, onLoginSuccess }) => {
  const [userType, setUserType] = useState<'CLIENT' | 'BUSINESS' | 'COURIER'>('CLIENT');
  const [viewMode, setViewMode] = useState<LoginViewMode>('LOGIN');
  const [loading, setLoading] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);
  
  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registration State
  const [regData, setRegData] = useState({
      name: '',
      phone: '',
      email: '',
      password: '',
      confirmPassword: '',
      cep: '',
      street: '',
      number: '',
      complement: '',
      district: '',
      city: '',
      state: ''
  });

  // Forgot Password State
  const [forgotEmail, setForgotEmail] = useState('');

  const [error, setError] = useState<string | null>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
        // Super Admin Hardcoded
        if (email === 'admin@menufaz.com' && password === '123456') {
            const adminUser: AuthUser = {
                uid: 'admin',
                email,
                password,
                role: 'ADMIN'
            };
            setAuthUser(adminUser);
            await createUserProfile(adminUser.uid, {
                name: 'Administrador',
                email,
                role: 'ADMIN'
            });
            onLoginSuccess('ADMIN', 'Administrador');
            return;
        }

        await login(email, password);
    } catch (err: any) {
        console.error(err);
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
            setError('E-mail ou senha incorretos.');
        } else if (err.code === 'auth/too-many-requests') {
            setError('Muitas tentativas. Tente mais tarde.');
        } else {
            setError('Erro ao fazer login: ' + err.message);
        }
    } finally {
        setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (regData.password !== regData.confirmPassword) {
          setError('As senhas não coincidem.');
          return;
      }

      if (regData.password.length < 6) {
          setError('A senha deve ter pelo menos 6 caracteres.');
          return;
      }

      if (userType === 'CLIENT' && (!regData.street || !regData.number)) {
          setError('Por favor, preencha o endereço completo.');
          return;
      }
      
      if (userType === 'COURIER' && !regData.city) {
          setError('Por favor, informe sua cidade de atuação.');
          return;
      }

      setLoading(true);
      setError(null);

      try {
          const newUser: AuthUser = {
              uid: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
              email: regData.email,
              password: regData.password,
              role: (userType === 'COURIER' ? 'COURIER' : 'CLIENT') as UserRole
          };

          await register(newUser);

          let initialAddresses: Address[] = [];
          if (userType === 'CLIENT' && regData.street) {
              initialAddresses.push({
                  id: Date.now().toString(),
                  label: 'Minha Casa',
                  street: regData.street,
                  number: regData.number,
                  coordinates: { lat: -23.561684, lng: -46.655981 } 
              });
          }

          // Define os dados do perfil, omitindo 'city' se n??o for COURIER para evitar undefined
          const profileData = {
              name: regData.name,
              email: regData.email,
              role: (userType === 'COURIER' ? 'COURIER' : 'CLIENT') as UserRole,
              phone: regData.phone,
              addresses: initialAddresses,
              ...(userType === 'COURIER' && { city: regData.city })
          };

          await createUserProfile(newUser.uid, profileData);

          // Auto-login acontece pelo AuthContext
      } catch (err: any) {
          console.error(err);
          if (err.code === 'auth/email-already-in-use') {
              setError('Este e-mail já está em uso.');
          } else {
              setError('Erro ao criar conta: ' + err.message);
          }
      } finally {
          setLoading(false);
      }
  };

  const handleCepBlur = async () => {
      const cep = regData.cep.replace(/\D/g, '');
      if (cep.length === 8) {
          setLoadingCep(true);
          try {
              const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
              const data = await response.json();
              
              if (!data.erro) {
                  setRegData(prev => ({
                      ...prev,
                      street: data.logradouro,
                      district: data.bairro,
                      city: data.localidade,
                      state: data.uf
                  }));
                  setTimeout(() => numberInputRef.current?.focus(), 100);
              } else {
                  setError('CEP não encontrado.');
              }
          } catch (err) {
              setError('Erro ao buscar CEP.');
          } finally {
              setLoadingCep(false);
          }
      }
  };

  // --- FORGOT PASSWORD FLOW ---

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);

      try {
          // Compat
          await sendPasswordResetEmail(forgotEmail);
          setViewMode('RESET_SUCCESS'); 
      } catch (err: any) {
          if (err.code === 'auth/user-not-found') {
              setError('E-mail não cadastrado.');
          } else {
              setError('Erro ao enviar e-mail: ' + err.message);
          }
      } finally {
          setLoading(false);
      }
  };

  const renderRightSideContent = () => {
      // ... (rest of the component remains the same)
      if (viewMode === 'RESET_SUCCESS') {
          return (
              <div className="w-full max-w-md mx-auto text-center py-10 animate-fade-in">
                  <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                      <CheckCircle size={50} className="text-green-600 dark:text-green-400" />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">E-mail Enviado!</h2>
                  <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                      Enviamos um link de recuperação para <strong>{forgotEmail}</strong>.<br/> Verifique sua caixa de entrada e também a pasta de spam.
                  </p>
                  <button 
                      onClick={() => {
                          setViewMode('LOGIN');
                          setForgotEmail('');
                      }}
                      className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
                  >
                      <LogIn size={20} /> Voltar para Login
                  </button>
              </div>
          );
      }

      if (viewMode === 'FORGOT_PASSWORD') {
          return (
              <div className="w-full max-w-md mx-auto py-10 animate-fade-in">
                  <button 
                      onClick={() => setViewMode('LOGIN')}
                      className="flex items-center gap-2 text-gray-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white transition-colors mb-8 font-bold"
                  >
                      <ArrowLeft size={20} /> Voltar
                  </button>

                  <div className="mb-8 text-center">
                      <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-red-600 dark:text-red-400 shadow-md">
                          <KeyRound size={40} />
                      </div>
                      <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Recuperar Senha</h2>
                      <p className="text-gray-500 dark:text-gray-400">
                          Informe seu e-mail cadastrado para receber o link de redefinição.
                      </p>
                  </div>

                  {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 p-4 rounded-xl mb-6 text-sm font-bold flex items-center gap-2">
                        <ArrowLeft size={16} className="shrink-0"/> {error}
                    </div>
                  )}

                  <form onSubmit={handleForgotPasswordSubmit} className="space-y-6">
                      <div>
                          <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2 uppercase tracking-wider">E-mail cadastrado</label>
                          <div className="relative">
                              <input 
                                  type="email" 
                                  placeholder="seu@email.com"
                                  value={forgotEmail}
                                  onChange={(e) => setForgotEmail(e.target.value)}
                                  className="w-full pl-12 pr-4 py-4 rounded-xl border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-4 focus:ring-red-100 dark:focus:ring-red-900/30 outline-none transition-all font-medium"
                                  required
                              />
                              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                          </div>
                      </div>

                      <button 
                          type="submit" 
                          disabled={loading}
                          className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 transform hover:-translate-y-1"
                      >
                          {loading ? <Loader2 className="animate-spin" /> : <>Enviar Link de Recuperação <Send size={18} /></>}
                      </button>
                  </form>
              </div>
          );
      }

      return (
        <div className="relative w-full max-w-md mx-auto py-10">
            <button 
                onClick={() => viewMode === 'REGISTER' ? setViewMode('LOGIN') : onNavigate(ViewState.HOME)}
                className="absolute top-0 left-0 flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
                <ArrowLeft size={20} /> {viewMode === 'REGISTER' ? 'Voltar ao Login' : 'Voltar ao Início'}
            </button>

            <div className="mb-8 mt-10">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
                    {viewMode === 'REGISTER' ? 'Crie sua conta' : 'Bem-vindo de volta'}
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    {viewMode === 'REGISTER' ? 'Preencha os dados abaixo para começar.' : 'Preencha seus dados para acessar a conta.'}
                </p>
            </div>

            <div className="bg-gray-100 dark:bg-slate-800 p-1 rounded-xl flex mb-8">
                <button 
                    className={`flex-1 py-2 rounded-lg text-[10px] sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${userType === 'CLIENT' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    onClick={() => setUserType('CLIENT')}
                >
                    <User size={16} /> Cliente
                </button>
                <button 
                    className={`flex-1 py-2 rounded-lg text-[10px] sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${userType === 'COURIER' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    onClick={() => setUserType('COURIER')}
                >
                    <Bike size={16} /> Entregador
                </button>
                <button 
                    className={`flex-1 py-2 rounded-lg text-[10px] sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${userType === 'BUSINESS' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    onClick={() => setUserType('BUSINESS')}
                >
                    <Building2 size={16} /> Loja
                </button>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 p-3 rounded-lg mb-4 text-sm font-medium">
                    {error}
                </div>
            )}

            <form onSubmit={viewMode === 'REGISTER' ? handleRegister : handleLogin} className="space-y-5">
                {viewMode === 'REGISTER' && (
                    <>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Nome Completo</label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="Seu nome"
                                        value={regData.name}
                                        onChange={(e) => setRegData({...regData, name: e.target.value})}
                                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                                        required
                                    />
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Celular</label>
                                <div className="relative">
                                    <input 
                                        type="tel" 
                                        placeholder="(00) 00000-0000"
                                        value={regData.phone}
                                        onChange={(e) => setRegData({...regData, phone: e.target.value})}
                                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                                    />
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                </div>
                            </div>
                        </div>

                         {userType === 'COURIER' && (
                             <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Cidade de Atuação</label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="Sua cidade"
                                        value={regData.city}
                                        onChange={(e) => setRegData({...regData, city: e.target.value})}
                                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                                        required
                                    />
                                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Você poderá alterar isso nas configurações depois.</p>
                            </div>
                         )}

                        {userType === 'CLIENT' && (
                            <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                                    <MapPin size={16} className="text-red-600"/> Endereço de Entrega
                                </h3>
                                
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                                        <div className="relative">
                                            <input 
                                                type="text" 
                                                placeholder="00000-000"
                                                value={regData.cep}
                                                onChange={(e) => setRegData({...regData, cep: e.target.value})}
                                                onBlur={handleCepBlur}
                                                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all"
                                                required
                                                maxLength={9}
                                            />
                                            {loadingCep ? (
                                                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-red-600 animate-spin" size={18} />
                                            ) : (
                                                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                            )}
                                        </div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rua / Logradouro</label>
                                        <div className="relative">
                                            <input 
                                                type="text" 
                                                placeholder="Ex: Av. Paulista"
                                                value={regData.street}
                                                onChange={(e) => setRegData({...regData, street: e.target.value})}
                                                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all"
                                                required
                                            />
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número</label>
                                        <input 
                                            ref={numberInputRef}
                                            type="text" 
                                            placeholder="Nº"
                                            value={regData.number}
                                            onChange={(e) => setRegData({...regData, number: e.target.value})}
                                            className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Comp. (Opcional)</label>
                                        <input 
                                            type="text" 
                                            placeholder="Apto, Bloco"
                                            value={regData.complement}
                                            onChange={(e) => setRegData({...regData, complement: e.target.value})}
                                            className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label>
                                        <div className="relative">
                                            <input 
                                                type="text" 
                                                placeholder="Bairro"
                                                value={regData.district}
                                                onChange={(e) => setRegData({...regData, district: e.target.value})}
                                                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all"
                                                required
                                            />
                                            <Home className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label>
                                        <input 
                                            type="text" 
                                            value={regData.city}
                                            onChange={(e) => setRegData({...regData, city: e.target.value})}
                                            className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white bg-gray-50"
                                            readOnly
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                                        <input 
                                            type="text" 
                                            value={regData.state}
                                            onChange={(e) => setRegData({...regData, state: e.target.value})}
                                            className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white bg-gray-50"
                                            readOnly
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">E-mail</label>
                    <div className="relative">
                        <input 
                            type="email" 
                            placeholder={userType === 'BUSINESS' && viewMode === 'LOGIN' ? "admin@empresa.com" : "seu@email.com"}
                            value={viewMode === 'REGISTER' ? regData.email : email}
                            onChange={(e) => viewMode === 'REGISTER' ? setRegData({...regData, email: e.target.value}) : setEmail(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                            required
                        />
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    </div>
                </div>
                
                <div>
                    <div className="flex justify-between mb-1">
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300">Senha</label>
                        {viewMode === 'LOGIN' && (
                            <button 
                                type="button"
                                onClick={() => {
                                    setViewMode('FORGOT_PASSWORD');
                                    setForgotEmail(email);
                                }}
                                className="text-sm text-red-600 dark:text-red-400 hover:underline font-bold"
                            >
                                Esqueceu a senha?
                            </button>
                        )}
                    </div>
                    <div className="relative">
                        <input 
                            type="password" 
                            placeholder="••••••••"
                            value={viewMode === 'REGISTER' ? regData.password : password}
                            onChange={(e) => viewMode === 'REGISTER' ? setRegData({...regData, password: e.target.value}) : setPassword(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                            required
                        />
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    </div>
                </div>

                {viewMode === 'REGISTER' && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Confirmar Senha</label>
                        <div className="relative">
                            <input 
                                type="password" 
                                placeholder="••••••••"
                                value={regData.confirmPassword}
                                onChange={(e) => setRegData({...regData, confirmPassword: e.target.value})}
                                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30 outline-none transition-all"
                                required
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        </div>
                    </div>
                )}

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-red-600 text-white font-bold py-3 rounded-lg hover:bg-red-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                >
                    {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        viewMode === 'REGISTER' ? (
                            <>Criar Conta <ArrowLeft className="rotate-180" size={18} /></>
                        ) : (
                            <>Entrar na conta <ArrowLeft className="rotate-180" size={18} /></>
                        )
                    )}
                </button>
            </form>

            <div className="mt-8 pt-8 border-t border-gray-100 dark:border-slate-800 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                    {viewMode === 'REGISTER' ? 'Já tem uma conta?' : 'Não tem uma conta?'} {' '}
                    <button 
                        onClick={handleSignUpClick} 
                        className="text-red-600 dark:text-red-400 font-bold hover:underline"
                    >
                        {viewMode === 'REGISTER' ? (
                            "Fazer Login"
                        ) : (
                            "Cadastre-se"
                        )}
                    </button>
                </p>
            </div>
        </div>
      );
  }

  const handleSignUpClick = () => {
      if (userType === 'BUSINESS') {
          onNavigate(ViewState.REGISTER_BUSINESS);
      } else {
          setViewMode('REGISTER');
          setError(null);
      }
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-slate-900">
        {/* Left Side - Visuals */}
        <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden items-center justify-center p-12">
            <div className="absolute inset-0 opacity-20">
                 <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-red-600 rounded-full filter blur-[120px] transform translate-x-1/2 -translate-y-1/2"></div>
                 <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-600 rounded-full filter blur-[120px] transform -translate-x-1/2 translate-y-1/2"></div>
            </div>
            
            <div className="relative z-10 max-w-md text-white">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/30">
                         <ShoppingBag size={24} strokeWidth={2.5} />
                    </div>
                    <span className="text-3xl font-bold tracking-tight">Menu<span className="text-red-500">Faz</span></span>
                </div>
                <h1 className="text-5xl font-bold mb-6 leading-tight">
                    {viewMode === 'REGISTER' ? 'Crie sua conta grátis.' : viewMode === 'FORGOT_PASSWORD' ? 'Recupere seu acesso.' : 'O delivery que conecta você ao melhor da cidade.'}
                </h1>
                <p className="text-xl text-gray-300 leading-relaxed">
                    {viewMode === 'REGISTER' 
                        ? 'Junte-se a milhares de usuários e peça sua comida favorita com poucos cliques.'
                        : viewMode === 'FORGOT_PASSWORD' 
                        ? 'Redefina sua senha em instantes e volte a pedir seus pratos favoritos.'
                        : 'Cadastre seu negócio ou peça sua comida favorita. Simples, rápido e moderno.'
                    }
                </p>
                
                {viewMode === 'LOGIN' && (
                    <div className="mt-12 flex gap-4">
                        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10 flex-1">
                            <p className="text-2xl font-bold">140k+</p>
                            <p className="text-sm text-gray-400">Usuários Ativos</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10 flex-1">
                            <p className="text-2xl font-bold">5.2k+</p>
                            <p className="text-sm text-gray-400">Parceiros</p>
                        </div>
                    </div>
                )}
                {viewMode === 'REGISTER' && (
                    <div className="mt-12 space-y-4">
                         <div className="flex items-center gap-3">
                             <CheckCircle className="text-green-500" /> <span className="text-gray-300">Sem taxas de adesão</span>
                         </div>
                         <div className="flex items-center gap-3">
                             <CheckCircle className="text-green-500" /> <span className="text-gray-300">Cupons exclusivos</span>
                         </div>
                         <div className="flex items-center gap-3">
                             <CheckCircle className="text-green-500" /> <span className="text-gray-300">Rastreio em tempo real</span>
                         </div>
                    </div>
                )}
            </div>
        </div>

        {/* Right Side - Form */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 sm:px-12 lg:px-24 overflow-y-auto">
            {renderRightSideContent()}
        </div>
    </div>
  );
};

export default Login;
