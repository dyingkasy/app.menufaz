
import React, { useState, useEffect } from 'react';
import { Lock, CheckCircle, Loader2, Eye, EyeOff, Building2, ShoppingBag, AlertTriangle } from 'lucide-react';
import { StoreRequest, ViewState } from '../types';
import { finalizeStoreRegistration, getStoreRequestById } from '../services/db';

interface FinishSignupProps {
    requestId: string;
    onNavigate: (view: ViewState) => void;
}

const FinishSignup: React.FC<FinishSignupProps> = ({ requestId, onNavigate }) => {
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [requestData, setRequestData] = useState<StoreRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        const loadRequest = async () => {
            try {
                const data = await getStoreRequestById(requestId);
                
                if (data) {
                    if (data.status === 'APPROVED') {
                        setRequestData(data);
                    } else {
                        setError("Esta solicita????o n??o est?? aprovada ou j?? foi finalizada.");
                    }
                } else {
                    setError("Solicita????o n??o encontrada.");
                }
            } catch (e) {
                setError("Erro ao carregar solicita????o.");
            } finally {
                setLoading(false);
            }
        };

        if (requestId) loadRequest();
    }, [requestId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);
        
        if (password.length < 6) {
            setSubmitError("A senha deve ter pelo menos 6 caracteres.");
            return;
        }
        if (password !== confirmPassword) {
            setSubmitError("As senhas não conferem.");
            return;
        }

        setSubmitting(true);
        try {
            await finalizeStoreRegistration(requestId, password);
            // Sucesso
            alert("Cadastro finalizado com sucesso! Você será redirecionado.");
            // O App.tsx provavelmente vai redirecionar automaticamente quando o AuthContext detectar o login,
            // mas forçamos a navegação aqui para garantir.
            onNavigate(ViewState.ADMIN); 
        } catch (e: any) {
            console.error(e);
            if(e.code === 'auth/email-already-in-use'){
                setSubmitError("Este e-mail já possui uma conta no sistema. Tente recuperar a senha.");
            } else {
                setSubmitError("Erro ao finalizar cadastro: " + e.message);
            }
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-red-600 animate-spin" />
            </div>
        );
    }

    if (error || !requestData) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
                        <Building2 size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Link Inválido</h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">{error || "Solicitação inválida."}</p>
                    <button onClick={() => onNavigate(ViewState.HOME)} className="text-red-600 font-bold hover:underline">
                        Ir para o início
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
             {/* Background Decor */}
             <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-purple-600 rounded-full filter blur-[150px] opacity-20 transform -translate-x-1/3 -translate-y-1/4 pointer-events-none"></div>
             <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-red-600 rounded-full filter blur-[150px] opacity-20 transform translate-x-1/3 translate-y-1/4 pointer-events-none"></div>

            <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10">
                <div className="bg-slate-100 dark:bg-slate-900 p-6 text-center border-b border-gray-200 dark:border-slate-700">
                     <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center text-white mx-auto mb-2 shadow-lg shadow-red-600/30">
                         <ShoppingBag size={24} strokeWidth={2.5} />
                     </div>
                     <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                         Menu<span className="text-red-600">Faz</span>
                     </h2>
                </div>
                
                <div className="p-8 md:p-10">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mb-2">Ativar Conta</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                            Olá <strong>{requestData.ownerName}</strong>, para acessar o painel da loja <strong>{requestData.storeName}</strong>, crie sua senha segura abaixo.
                        </p>
                    </div>

                    {submitError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6 text-sm flex items-center gap-2">
                            <AlertTriangle size={18} className="shrink-0" />
                            <span>{submitError}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                             <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Sua nova senha</label>
                             <div className="relative">
                                <input 
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-10 pr-12 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 dark:text-white transition-all"
                                    placeholder="No mínimo 6 caracteres"
                                    required
                                    disabled={submitting}
                                />
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <button 
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    disabled={submitting}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                             </div>
                        </div>

                        <div>
                             <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Confirme a senha</label>
                             <div className="relative">
                                <input 
                                    type={showPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full pl-10 pr-12 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 dark:text-white transition-all"
                                    placeholder="Repita a senha"
                                    required
                                    disabled={submitting}
                                />
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                             </div>
                        </div>

                        <button 
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-red-600/20 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2 mt-4 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="animate-spin" /> Processando...
                                </>
                            ) : 'Ativar Minha Loja'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default FinishSignup;
