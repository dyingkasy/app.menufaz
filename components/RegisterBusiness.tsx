
import React, { useState } from 'react';
import { ArrowLeft, CheckCircle, TrendingUp, Users, Wallet, ShieldCheck, MessageCircle, User, Mail, Phone, Store, MapPin, Loader2, LogIn } from 'lucide-react';
import { createStoreRequest, checkEmailExists } from '../services/db';
import { fetchCepData } from '../utils/geo';
import { ViewState } from '../types';

interface RegisterBusinessProps {
    onBack: () => void;
}

// Se tivéssemos acesso ao setView, poderíamos navegar para Login. 
// Como este componente é isolado na ViewState.REGISTER_BUSINESS, usaremos um link ou recarregamento se necessário,
// mas idealmente o usuário clica em "Voltar" ou no botão de Login.
// Para simplificar, vamos assumir que o usuário voltará manualmente ou adicionaremos um botão de ação.

const RegisterBusiness: React.FC<RegisterBusinessProps> = ({ onBack }) => {
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [existingEmailError, setExistingEmailError] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
      ownerName: '',
      storeName: '',
      phone: '',
      whatsapp: '',
      email: '',
      cep: '',
      street: '',
      number: '',
      district: '',
      city: '',
      state: '',
      complement: ''
  });

  // WhatsApp Link (Phone: 38998074444)
  const WHATSAPP_URL = "https://wa.me/5538998074444?text=Ol%C3%A1%2C%20tenho%20interesse%20em%20cadastrar%20meu%20restaurante%20no%20MenuFaz%20e%20gostaria%20de%20falar%20com%20um%20consultor.";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData({ ...formData, [e.target.name]: e.target.value });
      if(existingEmailError) setExistingEmailError(false);
  };

  const handleCepBlur = async () => {
      const cep = formData.cep.replace(/\D/g, '');
      if (cep.length !== 8) return;
      const data = await fetchCepData(cep);
      if (data) {
          setFormData(prev => ({
              ...prev,
              street: data.street,
              district: data.district,
              city: data.city,
              state: data.state
          }));
      } else {
          alert('CEP não encontrado.');
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setExistingEmailError(false);

      try {
          // 1. Verificar se o email já existe no sistema (Users)
          const emailExists = await checkEmailExists(formData.email);
          
          if (emailExists) {
              setExistingEmailError(true);
              setLoading(false);
              return;
          }

          // 2. Criar solicitação
          await createStoreRequest({
              ownerName: formData.ownerName,
              storeName: formData.storeName,
              phone: formData.phone,
              whatsapp: formData.whatsapp,
              email: formData.email,
              cep: formData.cep,
              street: formData.street,
              number: formData.number,
              district: formData.district,
              city: formData.city,
              state: formData.state,
              complement: formData.complement
          });
          setSuccess(true);
      } catch (error) {
          console.error(error);
          alert("Ocorreu um erro ao enviar sua solicitação. Tente novamente.");
      } finally {
          if (!existingEmailError) setLoading(false);
      }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 font-sans transition-colors duration-300">
      {/* Hero Section */}
      <div className="bg-slate-900 text-white relative overflow-hidden">
          {/* Background Decor */}
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-red-600 rounded-full filter blur-[150px] opacity-20 transform translate-x-1/3 -translate-y-1/4 pointer-events-none"></div>
          
          <div className="max-w-7xl mx-auto px-4 pt-6 pb-20 relative z-10">
             <nav className="flex justify-between items-center mb-12">
                 <button onClick={onBack} className="flex items-center gap-2 hover:text-red-400 transition-colors font-medium">
                    <ArrowLeft size={20} /> Voltar para o início
                 </button>
                 <div className="hidden md:flex gap-6 text-sm font-medium text-slate-300">
                     <a href="#beneficios" className="hover:text-white">Benefícios</a>
                     <a href="#planos" className="hover:text-white">Planos</a>
                 </div>
             </nav>

             <div className="grid md:grid-cols-2 gap-16 items-start">
                 <div className="animate-fade-in-up">
                     <div className="inline-block bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-4 py-1.5 text-sm font-semibold mb-6">
                         🚀 Plataforma nº1 em crescimento
                     </div>
                     <h1 className="text-4xl md:text-6xl font-extrabold mb-6 leading-tight">
                         Transforme seu negócio com o <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">MenuFaz</span>
                     </h1>
                     <p className="text-xl text-slate-300 mb-8 leading-relaxed">
                         Tenha seu próprio aplicativo de delivery, pague taxas justas e gerencie tudo em um único painel. Junte-se a parceiros de sucesso.
                     </p>
                     <div className="flex flex-col sm:flex-row gap-4">
                         <button 
                            onClick={() => setShowForm(true)}
                            className="bg-red-600 hover:bg-red-700 text-white text-lg font-bold py-4 px-8 rounded-xl transition-all shadow-lg shadow-red-900/30 hover:shadow-red-900/50 hover:-translate-y-1"
                         >
                             Cadastrar meu restaurante
                         </button>
                         <a 
                            href={WHATSAPP_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 text-lg font-bold py-4 px-8 rounded-xl transition-all flex items-center justify-center gap-2"
                         >
                             <MessageCircle /> Falar com consultor
                         </a>
                     </div>
                     <p className="mt-4 text-sm text-slate-500 flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-500" /> Sem cartão de crédito necessário para começar.
                     </p>
                 </div>

                 {/* Dynamic Content: Mockup or Form */}
                 <div className="relative">
                     {showForm ? (
                         <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-white rounded-3xl shadow-2xl p-8 animate-fade-in border border-slate-200 dark:border-slate-700">
                             {!success ? (
                                 <>
                                     <h3 className="text-2xl font-bold mb-2">Comece agora 🚀</h3>
                                     <p className="text-gray-500 dark:text-gray-400 mb-6">Preencha os dados para pré-cadastro.</p>
                                     
                                     {existingEmailError && (
                                         <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-xl mb-6 text-sm">
                                             <p className="font-bold flex items-center gap-2 mb-1"><User size={16}/> E-mail já cadastrado!</p>
                                             <p className="mb-3">Este e-mail já está em uso no sistema. Por favor, faça login ou recupere sua senha.</p>
                                             <button 
                                                onClick={() => window.location.reload()} // Simples reload para voltar ao estado inicial (onde pode ir pro login na home) ou usar onBack.
                                                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-bold w-full flex items-center justify-center gap-2"
                                             >
                                                 <LogIn size={16} /> Voltar para Login
                                             </button>
                                         </div>
                                     )}

                                     <form onSubmit={handleSubmit} className="space-y-4">
                                        <div>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Nome do Responsável</label>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Nome completo de quem vai administrar a loja.</p>
                                            <div className="relative mt-1">
                                                <input name="ownerName" value={formData.ownerName} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Seu nome completo" />
                                                <User className="absolute left-3 top-3 text-gray-400" size={18} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Nome do Restaurante</label>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Esse nome aparece para os clientes no app.</p>
                                            <div className="relative mt-1">
                                                <input name="storeName" value={formData.storeName} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Ex: Burger King da Esquina" />
                                                <Store className="absolute left-3 top-3 text-gray-400" size={18} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">E-mail de Login</label>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Será usado para acessar o painel da sua loja.</p>
                                            <div className="relative mt-1">
                                                <input name="email" value={formData.email} onChange={handleChange} type="email" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="seu@email.com" />
                                                <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Telefone do Responsável</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Usado para contato do cadastro.</p>
                                                <div className="relative mt-1">
                                                    <input name="phone" value={formData.phone} onChange={handleChange} type="tel" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="(00) 00000-0000" />
                                                    <Phone className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">WhatsApp do Comércio</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Número que vai receber os pedidos.</p>
                                                <div className="relative mt-1">
                                                    <input name="whatsapp" value={formData.whatsapp} onChange={handleChange} type="tel" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="(00) 00000-0000" />
                                                    <MessageCircle className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300">
                                                <MapPin size={16} /> Endereço do Comércio
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Preencha o endereço completo para delivery e retirada.</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">CEP</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Usado para localizar sua loja no mapa.</p>
                                                <div className="relative mt-1">
                                                    <input name="cep" value={formData.cep} onChange={handleChange} onBlur={handleCepBlur} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="00000-000" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Rua / Logradouro</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Nome da rua onde fica o comércio.</p>
                                                <div className="relative mt-1">
                                                    <input name="street" value={formData.street} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Av. Principal" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Número</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Número do imóvel.</p>
                                                <div className="relative mt-1">
                                                    <input name="number" value={formData.number} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="123" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Bairro</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Bairro onde fica a loja.</p>
                                                <div className="relative mt-1">
                                                    <input name="district" value={formData.district} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Centro" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Cidade</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Usamos essa cidade para entregas e cadastro.</p>
                                                <div className="relative mt-1">
                                                    <input name="city" value={formData.city} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Sua cidade" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Estado</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Sigla do estado (ex: SP).</p>
                                                <div className="relative mt-1">
                                                    <input name="state" value={formData.state} onChange={handleChange} type="text" required className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="UF" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Complemento</label>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Opcional: sala, bloco, referência.</p>
                                                <div className="relative mt-1">
                                                    <input name="complement" value={formData.complement} onChange={handleChange} type="text" className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none dark:text-white" placeholder="Ex: Sala 2" />
                                                    <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <button 
                                            type="submit"
                                            disabled={loading || existingEmailError}
                                            className="w-full bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                                        >
                                            {loading ? <Loader2 className="animate-spin" /> : 'Continuar Cadastro'}
                                        </button>
                                     </form>
                                 </>
                             ) : (
                                 <div className="text-center py-8">
                                     <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                         <CheckCircle size={40} className="text-green-600 dark:text-green-400" />
                                     </div>
                                     <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Sucesso!</h3>
                                     <p className="text-gray-600 dark:text-gray-300 mb-6">
                                         Recebemos seus dados. Nosso consultor analisará seu cadastro e você receberá um e-mail para ativação em breve.
                                     </p>
                                     <button 
                                        onClick={onBack}
                                        className="text-red-600 dark:text-red-400 font-bold hover:underline"
                                     >
                                         Voltar para o site
                                     </button>
                                 </div>
                             )}
                         </div>
                     ) : (
                         <div className="relative z-10 transform rotate-3 hover:rotate-1 transition-transform duration-500 hidden md:block">
                             {/* Mockup Card */}
                             <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden max-w-sm mx-auto border-4 border-slate-800 dark:border-slate-600">
                                <div className="bg-slate-100 dark:bg-slate-900 p-4 border-b dark:border-slate-700 flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                </div>
                                 <div className="p-6">
                                     <div className="flex justify-between items-center mb-6">
                                         <div>
                                             <p className="text-sm text-gray-500 dark:text-gray-400">Faturamento Hoje</p>
                                             <p className="text-3xl font-bold text-slate-900 dark:text-white">R$ 1.250,00</p>
                                         </div>
                                         <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center">
                                             <TrendingUp size={24} />
                                         </div>
                                     </div>
                                     <div className="space-y-4">
                                         <div className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg flex justify-between items-center">
                                             <span className="text-sm font-medium text-slate-700 dark:text-gray-200">Pedidos Aceitos</span>
                                             <span className="text-sm font-bold text-green-600 dark:text-green-400">24</span>
                                         </div>
                                         <div className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg flex justify-between items-center">
                                             <span className="text-sm font-medium text-slate-700 dark:text-gray-200">Ticket Médio</span>
                                             <span className="text-sm font-bold text-blue-600 dark:text-blue-400">R$ 52,00</span>
                                         </div>
                                     </div>
                                     <div className="mt-6 pt-6 border-t dark:border-slate-700">
                                         <p className="text-xs text-gray-400 uppercase font-bold mb-3">Últimos Pedidos</p>
                                         <div className="space-y-3">
                                            {[1, 2].map((i) => (
                                                <div key={i} className="flex gap-3 items-center">
                                                    <div className="w-8 h-8 bg-gray-200 dark:bg-slate-700 rounded-full"></div>
                                                    <div className="flex-1">
                                                        <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded w-20 mb-1"></div>
                                                        <div className="h-2 bg-gray-100 dark:bg-slate-700/50 rounded w-12"></div>
                                                    </div>
                                                </div>
                                            ))}
                                         </div>
                                     </div>
                                 </div>
                             </div>
                         </div>
                     )}
                 </div>
             </div>
          </div>
      </div>

      {/* Stats Strip */}
      <div className="bg-white dark:bg-slate-800 border-b dark:border-slate-700">
          <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
              <div className="text-center">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">30%</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Aumento médio de vendas</p>
              </div>
              <div className="text-center border-l border-gray-100 dark:border-slate-700">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">0%</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Taxa de adesão</p>
              </div>
              <div className="text-center border-l border-gray-100 dark:border-slate-700">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">24h</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Para estar online</p>
              </div>
              <div className="text-center border-l border-gray-100 dark:border-slate-700">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">4.9/5</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Satisfação dos parceiros</p>
              </div>
          </div>
      </div>

      {/* Benefits */}
      <div id="beneficios" className="max-w-7xl mx-auto px-4 py-20">
          <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Por que o MenuFaz é diferente?</h2>
              <p className="text-lg text-gray-600 dark:text-gray-400">Não somos apenas um app de delivery. Somos uma plataforma completa de gestão e crescimento para o seu negócio.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
              <div className="group p-8 rounded-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-900/50 hover:shadow-xl transition-all">
                  <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Wallet size={28} />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-slate-900 dark:text-white">Menores Taxas</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                      Enquanto outros cobram até 30%, nossa taxa máxima é de 12%. Mais lucro no seu bolso a cada pedido.
                  </p>
              </div>
              
              <div className="group p-8 rounded-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-900/50 hover:shadow-xl transition-all">
                  <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <MessageCircle size={28} />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-slate-900 dark:text-white">Suporte Humanizado</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                      Fale diretamente com nossos consultores pelo WhatsApp (38) 99807-4444. Nada de robôs travados.
                  </p>
              </div>

              <div className="group p-8 rounded-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-900/50 hover:shadow-xl transition-all">
                  <div className="w-14 h-14 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <ShieldCheck size={28} />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-slate-900 dark:text-white">Garantia de Pagamento</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                      Receba seus repasses semanalmente com total segurança e transparência no painel financeiro.
                  </p>
              </div>
          </div>
      </div>

      {/* CTA */}
      <div className="bg-slate-50 dark:bg-slate-900/50 py-20">
          <div className="max-w-5xl mx-auto px-4 bg-gradient-to-r from-red-600 to-orange-600 dark:from-red-700 dark:to-orange-800 rounded-3xl p-12 text-center text-white relative overflow-hidden shadow-2xl">
              <div className="relative z-10">
                  <h2 className="text-3xl md:text-4xl font-bold mb-6">Pronto para decolar suas vendas?</h2>
                  <p className="text-red-100 mb-8 text-lg max-w-2xl mx-auto">Junte-se a milhares de empreendedores que estão mudando a forma de fazer delivery no Brasil.</p>
                  <button 
                    onClick={() => {
                        setShowForm(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="bg-white text-red-600 dark:text-red-700 text-lg font-bold py-4 px-12 rounded-xl hover:bg-gray-100 transition-all shadow-lg"
                  >
                      Quero me cadastrar agora
                  </button>
              </div>
              
              {/* Circles */}
              <div className="absolute -left-10 -bottom-10 w-64 h-64 bg-white opacity-10 rounded-full"></div>
              <div className="absolute -right-10 -top-10 w-64 h-64 bg-white opacity-10 rounded-full"></div>
          </div>
      </div>
    </div>
  );
};

export default RegisterBusiness;
