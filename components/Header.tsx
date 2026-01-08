import React, { useState, useEffect } from 'react';
import { MapPin, Search, ShoppingBag, Menu, X, User, Building2, ChevronDown, ShieldCheck, Moon, Sun, ClipboardList } from 'lucide-react';
import { ViewState, UserRole } from '../types';
import { formatCurrencyBRL } from '../utils/format';

interface HeaderProps {
  onNavigate: (view: ViewState) => void;
  currentView: ViewState;
  onOpenLocation: () => void;
  currentAddress: string;
  userRole?: UserRole;
  userName?: string;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
  cartItemCount?: number;
  cartTotal?: number;
  onOpenCart?: () => void;
  onSearch?: (text: string) => void;
}

const Header: React.FC<HeaderProps> = ({ 
    onNavigate, 
    currentView, 
    onOpenLocation, 
    currentAddress, 
    userRole = 'GUEST', 
    userName, 
    isDarkMode, 
    toggleTheme,
    cartItemCount = 0,
    cartTotal = 0,
    onOpenCart,
    onSearch
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleProfileClick = () => {
      if (userRole === 'GUEST') {
          onNavigate(ViewState.LOGIN);
      } else if (userRole === 'ADMIN') {
          onNavigate(ViewState.ADMIN);
      } else if (userRole === 'BUSINESS') {
          onNavigate(ViewState.ADMIN);
      } else if (userRole === 'COURIER') {
          onNavigate(ViewState.COURIER_DASHBOARD);
      } else {
          // Client
          onNavigate(ViewState.CLIENT_PROFILE);
      }
      setMobileMenuOpen(false);
  };

  return (
    <header className={`sticky top-0 z-50 w-full transition-all duration-300 border-b border-transparent ${isScrolled ? 'bg-white dark:bg-slate-900 shadow-md py-2 border-gray-200 dark:border-slate-800' : 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md py-4'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          
          {/* Logo */}
          <div 
            className="flex items-center gap-2 cursor-pointer group" 
            onClick={() => onNavigate(ViewState.HOME)}
          >
            <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white transform group-hover:rotate-3 transition-transform">
              <ShoppingBag size={24} strokeWidth={2.5} />
            </div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              Menu<span className="text-red-600">Faz</span>
            </span>
          </div>

          {/* Desktop Location & Search */}
          <div className="hidden md:flex flex-1 max-w-2xl items-center gap-4 mx-8">
            <button 
              onClick={onOpenLocation}
              className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 px-3 py-2 rounded-lg transition-colors whitespace-nowrap max-w-[250px] border border-transparent hover:border-gray-200 dark:hover:border-slate-700"
            >
              <MapPin size={18} className="text-red-600 flex-shrink-0" />
              <div className="flex flex-col items-start text-left overflow-hidden">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Entregar em</span>
                <span className="truncate font-bold text-gray-800 dark:text-white w-full flex items-center gap-1">
                    {currentAddress} <ChevronDown size={12} />
                </span>
              </div>
            </button>

            <div className="flex-1 relative group">
              <input 
                type="text" 
                placeholder="Busque por item ou loja..." 
                className="w-full bg-gray-100 dark:bg-slate-800 border-none rounded-lg py-2.5 pl-10 pr-4 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-900/30 focus:bg-white dark:focus:bg-slate-800 transition-all outline-none placeholder-gray-400 dark:placeholder-gray-500"
                onChange={(e) => onSearch && onSearch(e.target.value)}
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 group-focus-within:text-red-500" size={18} />
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-3">
             {/* Theme Toggle */}
            <button 
                onClick={toggleTheme}
                className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                title={isDarkMode ? 'Modo Claro' : 'Modo Escuro'}
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            
            {/* Cart Button */}
            {cartItemCount > 0 && (
                <button 
                    onClick={onOpenCart}
                    className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm border border-red-100 dark:border-red-900/30"
                >
                    <div className="relative">
                        <ShoppingBag size={20} />
                        <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                            {cartItemCount}
                        </span>
                    </div>
                    <span className="hidden lg:inline">{formatCurrencyBRL(cartTotal)}</span>
                </button>
            )}

            {/* Role Based Actions */}
            {userRole === 'ADMIN' ? (
                 <button 
                    onClick={() => onNavigate(ViewState.ADMIN)}
                    className="flex items-center gap-2 text-slate-900 dark:text-white font-bold px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-sm"
                 >
                    <ShieldCheck size={18} />
                    Voltar p/ Admin
                 </button>
            ) : userRole !== 'GUEST' ? (
                <button 
                    onClick={() => onNavigate(ViewState.CLIENT_ORDERS)}
                    className="hidden lg:flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 font-medium px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-slate-800 transition-colors text-sm"
                >
                    <ClipboardList size={18} />
                    Meus Pedidos
                </button>
            ) : (
                <button 
                onClick={() => onNavigate(ViewState.REGISTER_BUSINESS)}
                className="hidden lg:flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 font-medium px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-slate-800 transition-colors text-sm"
                >
                <Building2 size={18} />
                Cadastrar meu negócio
                </button>
            )}
            
            <button 
              onClick={handleProfileClick}
              className="flex items-center gap-2 text-gray-700 dark:text-gray-200 font-semibold px-4 py-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              <User size={18} />
              {userRole !== 'GUEST' ? (userName ? `Olá, ${userName.split(' ')[0]}` : 'Minha Conta') : 'Entrar'}
            </button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
             <button 
                onClick={toggleTheme}
                className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {cartItemCount > 0 && (
                <button 
                    onClick={onOpenCart}
                    className="p-2 text-red-600 dark:text-red-400 relative"
                >
                    <ShoppingBag size={24} />
                    <span className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900">
                        {cartItemCount}
                    </span>
                </button>
            )}
            <button 
                className="p-2 text-gray-600 dark:text-gray-300"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
                {mobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 space-y-4 border-t border-gray-100 dark:border-slate-800 pt-4 animate-fade-in">
            <div 
                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg mx-2" 
                onClick={() => {
                    onOpenLocation();
                    setMobileMenuOpen(false);
                }}
            >
              <MapPin size={20} className="text-red-600" />
              <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Entregar em</p>
                  <p className="font-bold text-gray-800 dark:text-white text-sm">{currentAddress}</p>
              </div>
              <ChevronDown size={16} className="ml-auto text-gray-400" />
            </div>
            
            <div className="relative px-2">
              <input 
                type="text" 
                placeholder="Busque por item ou loja..." 
                className="w-full bg-gray-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-gray-700 dark:text-gray-200 outline-none"
                onChange={(e) => onSearch && onSearch(e.target.value)}
              />
              <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            </div>
            
            <div className="flex flex-col gap-2 px-2">
              <button 
                onClick={handleProfileClick}
                className="w-full bg-red-600 text-white font-bold py-3 rounded-lg"
              >
                {userRole !== 'GUEST' ? (userName ? `Olá, ${userName.split(' ')[0]}` : 'Minha Conta') : 'Entrar'}
              </button>

              {userRole !== 'GUEST' && userRole !== 'ADMIN' && (
                   <button 
                    onClick={() => { onNavigate(ViewState.CLIENT_ORDERS); setMobileMenuOpen(false); }}
                    className="w-full bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-bold py-3 rounded-lg border border-gray-200 dark:border-slate-600"
                  >
                    Meus Pedidos
                  </button>
              )}
              
              {userRole === 'ADMIN' ? (
                  <button 
                    onClick={() => { onNavigate(ViewState.ADMIN); setMobileMenuOpen(false); }}
                    className="w-full bg-slate-900 dark:bg-slate-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                  >
                    <ShieldCheck size={18} /> Painel Admin
                  </button>
              ) : (
                <button 
                    onClick={() => { onNavigate(ViewState.REGISTER_BUSINESS); setMobileMenuOpen(false); }}
                    className="w-full border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 font-bold py-3 rounded-lg"
                >
                    Cadastrar meu negócio
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
