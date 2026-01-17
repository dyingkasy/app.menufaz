import React from 'react';
import { ArrowLeft, ShieldCheck, KeyRound, PlugZap, Database, ListChecks, TerminalSquare } from 'lucide-react';

interface ApiDocsProps {
  onBack: () => void;
}

const ApiDocs: React.FC<ApiDocsProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-[#f6f2ea] text-slate-900">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
        :root {
          --api-ink: #10131a;
          --api-coral: #ff5a3d;
          --api-sand: #f6f2ea;
          --api-olive: #0c5b4a;
          --api-cream: #fff8ef;
        }
        pre {
          white-space: pre-wrap;
          word-break: break-word;
        }
        @media (min-width: 768px) {
          pre {
            white-space: pre;
            word-break: normal;
          }
        }
      `}</style>

      <div className="relative overflow-x-hidden">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#ff5a3d]/20 blur-3xl" />
        <div className="absolute top-40 -left-32 h-96 w-96 rounded-full bg-[#0c5b4a]/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-[#f0d8c4]/70 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 py-10">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-bold text-slate-600 backdrop-blur hover:bg-white"
          >
            <ArrowLeft size={16} /> Voltar ao painel
          </button>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-slate-500">
                <ShieldCheck size={14} className="text-[#ff5a3d]" /> Menufaz API
              </div>
              <h1
                className="text-4xl sm:text-5xl font-bold leading-tight text-[color:var(--api-ink)]"
                style={{ fontFamily: '"Space Grotesk", sans-serif' }}
              >
                Guia de homologacao da API Menufaz para integracao com Qualifaz Entregas
              </h1>
              <p className="text-base sm:text-lg text-slate-600 max-w-2xl">
                Esta pagina descreve o fluxo oficial para integrar pedidos do MenuFaz com a sua plataforma.
                O acesso e feito por Merchant ID exclusivo de cada loja.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                  <KeyRound size={20} className="text-[#ff5a3d]" />
                  <h3 className="mt-3 font-bold text-slate-900">Chave unica por loja</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Gere o Merchant ID em Configuracoes &gt; Homologacao dentro do painel da loja.
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                  <PlugZap size={20} className="text-[#0c5b4a]" />
                  <h3 className="mt-3 font-bold text-slate-900">Sincronismo total</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Consulte pedidos e atualize status, pagamento, chat e reembolsos pela API.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-[#10131a] p-6 text-white shadow-2xl">
              <p className="text-xs uppercase tracking-[0.26em] text-white/50">Base URL</p>
              <p className="mt-2 text-lg font-bold">https://app.menufaz.com/api</p>
              <div className="mt-6 space-y-4 text-sm">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white/90">Header obrigatorio</p>
                  <p className="mt-2 font-mono text-xs text-white/70">x-merchant-id: &lt;UUID&gt;</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white/90">Formato</p>
                  <p className="mt-2 text-white/70">
                    JSON em todas as respostas. Datas em ISO-8601.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white/90">Status principais</p>
                  <p className="mt-2 text-white/70">
                    PENDING, PREPARING, WAITING_COURIER, DELIVERING, COMPLETED, CANCELLED
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <Database size={18} className="text-[#ff5a3d]" />
                <h2 className="text-xl font-bold">Fluxo de homologacao (passo a passo)</h2>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-slate-600">
                <li>Passo 1 - Implementar o cliente HTTP na Qualifaz Entregas para consumir a API MenuFaz.</li>
                <li>Passo 2 - Gerar o Merchant ID no MenuFaz (Configuracoes &gt; Homologacao).</li>
                <li>Passo 3 - Configurar o header <span className="font-mono">x-merchant-id</span> em todas as requisicoes.</li>
                <li>Passo 4 - Consumir <span className="font-mono">GET /qualifaz/orders</span> para listar pedidos.</li>
                <li>Passo 5 - Sincronizar status via <span className="font-mono">PUT /qualifaz/orders/:id/status</span>.</li>
                <li>Passo 6 - Sincronizar status internos (WAITING_COURIER/DELIVERING/COMPLETED/CANCELLED).</li>
                <li>Passo 7 - Se necessario, atualizar pagamento, chat, reembolso ou courier pelos endpoints dedicados.</li>
              </ol>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <ListChecks size={18} className="text-[#0c5b4a]" />
                <h2 className="text-xl font-bold">Campos importantes do pedido</h2>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>id, status, createdAt, time, storeCity</li>
                <li>storeId, storeName, userId, customerId</li>
                <li>customerName, customerPhone, deliveryAddress, storeAddress</li>
                <li>type, pickup/isPickup, tableNumber, tableSessionId</li>
                <li>items, lineItems, total, deliveryFee, paymentMethod</li>
                <li>storeCoordinates, deliveryCoordinates</li>
                <li>notes, cancelReason, refundStatus, refundReason, chat</li>
                <li>courierId, courierStage, cpf (quando informado)</li>
              </ul>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <TerminalSquare size={18} className="text-[#ff5a3d]" />
              <h2 className="text-xl font-bold">Endpoints disponiveis</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                'GET /qualifaz/cancel-reasons',
                'GET /qualifaz/orders',
                'GET /qualifaz/orders/:id',
                'PUT /qualifaz/orders/:id/status',
                'PUT /qualifaz/orders/:id/assign',
                'PUT /qualifaz/orders/:id/courier-stage',
                'PUT /qualifaz/orders/:id/payment',
                'PUT /qualifaz/orders/:id/refund',
                'PUT /qualifaz/orders/:id/chat'
              ].map((endpoint) => (
                <div
                  key={endpoint}
                  className="rounded-2xl border border-slate-200 bg-[#fff8ef] px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <span className="font-mono">{endpoint}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Exemplo - listar pedidos</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/qualifaz/orders" \\
  -H "x-merchant-id: SEU_MERCHANT_ID"`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Exemplo - atualizar status</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X PUT "https://app.menufaz.com/api/qualifaz/orders/ORDER_ID/status" \\
  -H "x-merchant-id: SEU_MERCHANT_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"PREPARING"}'`}
                </pre>
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <Database size={18} className="text-[#0c5b4a]" />
              <h2 className="text-xl font-bold">API de gestao da loja (MenuFaz)</h2>
            </div>
            <p className="mt-2 text-sm text-slate-600 max-w-3xl">
              Endpoints internos para configurar horarios, auto-aceite, auto-abertura, pausa operacional e cadastro da empresa.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                'GET /stores/:id',
                'PUT /stores/:id',
                'GET /stores/:id/availability',
                'PUT /stores/:id/schedule',
                'PUT /stores/:id/auto-open',
                'PUT /stores/:id/auto-accept',
                'POST /stores/:id/pause',
                'DELETE /stores/:id/pause',
                'GET /stores/:id/company-profile'
              ].map((endpoint) => (
                <div
                  key={endpoint}
                  className="rounded-2xl border border-slate-200 bg-[#f2f7f4] px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <span className="font-mono">{endpoint}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Exemplo - pausar loja</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X POST "https://app.menufaz.com/api/stores/STORE_ID/pause" \\
  -H "Content-Type: application/json" \\
  -d '{"minutes":30,"reason":"Pausa operacional"}'`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Exemplo - disponibilidade</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/stores/STORE_ID/availability"`}
                </pre>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Payload - horarios</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "autoOpenClose": true,
  "schedule": [
    {
      "day": "Domingo",
      "isMorningOpen": true,
      "morningOpenTime": "09:00",
      "morningCloseTime": "12:00",
      "isAfternoonOpen": true,
      "afternoonOpenTime": "14:00",
      "afternoonCloseTime": "22:00"
    }
  ]
}`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta - availability</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "isOpen": false,
  "reason": "PAUSED",
  "scheduleOpen": true,
  "autoOpenClose": true,
  "pause": {
    "active": true,
    "reason": "Pausa operacional",
    "endsAt": "2025-01-01T12:30:00Z"
  },
  "nextChangeAt": "2025-01-01T12:30:00Z"
}`}
                </pre>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Erros comuns (400)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{ "error": "schedule must be a non-empty array" }
{ "error": "invalid schedule time format" }
{ "error": "enabled must be boolean" }
{ "error": "minutes must be a number greater than 0" }
{ "error": "reason required" }`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Erros comuns (404)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{ "error": "not found" }`}
                </pre>
                <p className="mt-3 text-xs text-slate-500">
                  Retornado quando o <span className="font-mono">storeId</span> nao existe.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Validacoes rapidas</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>Horarios aceitam formato 24h <span className="font-mono">HH:mm</span>.</li>
                <li><span className="font-mono">autoOpenClose</span> e <span className="font-mono">enabled</span> sao booleanos.</li>
                <li>Pausa exige <span className="font-mono">minutes &gt; 0</span> e <span className="font-mono">reason</span>.</li>
                <li>Availability retorna <span className="font-mono">reason</span>: OPEN_MANUAL, OPEN_SCHEDULE, CLOSED_MANUAL, CLOSED_SCHEDULE, PAUSED.</li>
              </ul>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta - auto-aceite</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "autoAcceptOrders": true
}`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta - auto-abertura</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "autoOpenClose": true
}`}
                </pre>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Request - auto-aceite</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X PUT "https://app.menufaz.com/api/stores/STORE_ID/auto-accept" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled":true}'`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Request - auto-abertura</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X PUT "https://app.menufaz.com/api/stores/STORE_ID/auto-open" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled":true}'`}
                </pre>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta - company profile</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "store": {
    "name": "Loja Exemplo",
    "cnpj": "00000000000000",
    "city": "Cidade",
    "phone": "11999999999",
    "email": "contato@loja.com"
  },
  "owner": {
    "id": "UUID",
    "name": "Responsavel",
    "email": "responsavel@loja.com",
    "phone": "11988888888"
  }
}`}
              </pre>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Request - company profile</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/stores/STORE_ID/company-profile"`}
              </pre>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Request - schedule</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X PUT "https://app.menufaz.com/api/stores/STORE_ID/schedule" \\
  -H "Content-Type: application/json" \\
  -d '{
    "autoOpenClose": true,
    "schedule": [
      {
        "day": "Domingo",
        "isMorningOpen": true,
        "morningOpenTime": "09:00",
        "morningCloseTime": "12:00",
        "isAfternoonOpen": true,
        "afternoonOpenTime": "14:00",
        "afternoonCloseTime": "22:00"
      }
    ]
  }'`}
              </pre>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Postman (resumo)</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "info": { "name": "MenuFaz - Store API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": [
    { "name": "Availability", "request": { "method": "GET", "url": "{{baseUrl}}/stores/{{storeId}}/availability" } },
    { "name": "Auto Accept", "request": { "method": "PUT", "url": "{{baseUrl}}/stores/{{storeId}}/auto-accept", "body": { "mode": "raw", "raw": "{\\n  \\"enabled\\": true\\n}" } } },
    { "name": "Auto Open", "request": { "method": "PUT", "url": "{{baseUrl}}/stores/{{storeId}}/auto-open", "body": { "mode": "raw", "raw": "{\\n  \\"enabled\\": true\\n}" } } },
    { "name": "Pause", "request": { "method": "POST", "url": "{{baseUrl}}/stores/{{storeId}}/pause", "body": { "mode": "raw", "raw": "{\\n  \\"minutes\\": 30,\\n  \\"reason\\": \\"Pausa operacional\\"\\n}" } } },
    { "name": "Company Profile", "request": { "method": "GET", "url": "{{baseUrl}}/stores/{{storeId}}/company-profile" } }
  ]
}`}
              </pre>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Exemplo de GET + resposta JSON</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">GET /qualifaz/orders/:id</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/qualifaz/orders/ORDER_ID" \\
  -H "x-merchant-id: SEU_MERCHANT_ID"`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta (exemplo)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "id": "UUID",
  "status": "PENDING",
  "storeId": "UUID",
  "storeName": "Loja Exemplo",
  "userId": "UUID",
  "customerId": "UUID",
  "storeCity": "Cidade",
  "createdAt": "2025-01-01T12:00:00Z",
  "time": "12:00:00",
  "type": "DELIVERY",
  "pickup": false,
  "isPickup": false,
  "notes": "Sem cebola",
  "customerName": "Nome",
  "customerPhone": "11999999999",
  "deliveryFee": 5,
  "deliveryAddress": {
    "street": "Rua X",
    "number": "123",
    "district": "Centro",
    "city": "Cidade",
    "state": "UF",
    "complement": "Apto 12"
  },
  "storeAddress": {
    "street": "Rua Loja",
    "number": "50",
    "district": "Centro",
    "city": "Cidade",
    "state": "UF",
    "complement": ""
  },
  "storeCoordinates": { "lat": -23.55, "lng": -46.63 },
  "deliveryCoordinates": { "lat": -23.56, "lng": -46.64 },
  "tableNumber": null,
  "tableSessionId": null,
  "items": ["1x Produto (Extras) [Obs: pouco sal]"],
  "lineItems": [
    {
      "productId": "UUID",
      "name": "Produto",
      "quantity": 1,
      "unitPrice": 10.5,
      "totalPrice": 10.5,
      "notes": "pouco sal",
      "options": [{ "groupName": "Extras", "optionName": "Queijo", "price": 2 }]
    }
  ],
  "total": 10.5,
  "paymentMethod": "Pix",
  "refundStatus": "NONE",
  "refundReason": null,
  "cancelReason": null,
  "chat": [],
  "courierId": "UUID",
  "courierStage": "ASSIGNED",
  "cpf": "00000000000"
}`}
                </pre>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">
              A API retorna o objeto completo do pedido conforme salvo no MenuFaz (campos adicionais tambem sao enviados).
              Quando o campo <span className="font-mono">type</span> nao estiver salvo, a API infere por endereco ou mesa.
              Campos opcionais podem vir nulos/ausentes (ex: deliveryAddress em retirada). paymentMethod e string descritiva.
            </p>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Exemplo de GET + resposta JSON (loja)</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">GET /stores/:id/availability</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/stores/STORE_ID/availability"`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta (exemplo)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "isOpen": true,
  "reason": "OPEN_SCHEDULE",
  "scheduleOpen": true,
  "autoOpenClose": true,
  "pause": null,
  "nextChangeAt": "2025-01-01T22:00:00Z"
}`}
                </pre>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">GET /stores/:id/company-profile</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`curl -X GET "https://app.menufaz.com/api/stores/STORE_ID/company-profile"`}
                </pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta (exemplo)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{
  "storeId": "UUID",
  "store": {
    "name": "Loja Exemplo",
    "cnpj": "00000000000000",
    "city": "Cidade",
    "phone": "11999999999",
    "email": "contato@loja.com"
  },
  "owner": {
    "id": "UUID",
    "name": "Responsavel",
    "email": "responsavel@loja.com",
    "phone": "11988888888"
  }
}`}
                </pre>
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Modelos de cancelamento (GET /qualifaz/cancel-reasons)</h2>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-900 p-5 text-xs text-emerald-200">
{`{
  "reasons": [
    { "code": "CUSTOMER_REQUEST", "label": "Cliente pediu cancelamento" },
    { "code": "ITEM_UNAVAILABLE", "label": "Item indisponivel" },
    { "code": "STORE_CLOSED", "label": "Loja fechada" },
    { "code": "DELIVERY_UNAVAILABLE", "label": "Entrega indisponivel" },
    { "code": "PAYMENT_ISSUE", "label": "Problema no pagamento" },
    { "code": "ADDRESS_INVALID", "label": "Endereco invalido" },
    { "code": "OUT_OF_STOCK", "label": "Sem estoque" },
    { "code": "OTHER", "label": "Outro motivo" }
  ]
}`}
            </pre>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Filtros e parametros</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>
                  <span className="font-semibold text-slate-800">GET /qualifaz/orders</span> suporta{" "}
                  <span className="font-mono">status</span> e <span className="font-mono">since</span> (ISO-8601).
                </li>
                <li>Use o header x-merchant-id em todas as requisicoes.</li>
                <li>Intervalo recomendado de polling: 5-15 segundos.</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Erros comuns</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>400 - merchantId required</li>
                <li>404 - merchant not found / order not found</li>
                <li>400 - status required / paymentMethod required</li>
              </ul>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Codigos de erro</p>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  <li>QUALIFAZ_MERCHANT_ID_REQUIRED</li>
                  <li>QUALIFAZ_MERCHANT_NOT_FOUND</li>
                  <li>QUALIFAZ_ORDER_NOT_FOUND</li>
                  <li>QUALIFAZ_STATUS_REQUIRED</li>
                  <li>QUALIFAZ_COURIER_ID_REQUIRED</li>
                  <li>QUALIFAZ_STAGE_REQUIRED</li>
                  <li>QUALIFAZ_PAYMENT_METHOD_REQUIRED</li>
                  <li>QUALIFAZ_INTERNAL_ERROR</li>
                </ul>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resposta de erro (modelo)</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-200">
{`{ "error": "merchant not found", "code": "QUALIFAZ_MERCHANT_NOT_FOUND" }`}
                </pre>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Modelos de payload (exemplos)</h2>
              <div className="mt-4 space-y-4 text-xs">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Status</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "status": "PREPARING" }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Cancelamento</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "status": "CANCELLED", "reason": "Item indisponivel" }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Pagamento</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "paymentMethod": "PIX" }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Reembolso</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "refundStatus": "APPROVED", "refundReason": "Item indisponivel" }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Chat</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "chat": [{ "from": "store", "message": "Pedido em preparo" }] }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Courier stage</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "stage": "TO_CUSTOMER" }`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Assign courier</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-4 text-emerald-200">
{`{ "courierId": "UUID" }`}
                  </pre>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Checklist rapido de homologacao</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>Merchant ID gerado e salvo na Qualifaz.</li>
                <li>Header x-merchant-id enviado em todas as rotas.</li>
                <li>GET /qualifaz/orders retornando pedidos da loja correta.</li>
                <li>PUT /status atualiza o pedido no MenuFaz.</li>
                <li>Validar fluxo CANCELLED com motivo.</li>
                <li>Validar logs no Super Admin (Logs de Erro) com fonte "qualifaz".</li>
              </ul>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Troubleshooting rapido</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Pedidos nao chegam</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Confirme o Merchant ID correto no header.</li>
                  <li>Verifique se a loja gerou o Merchant ID.</li>
                  <li>Teste `GET /qualifaz/orders` sem filtros.</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Erro 404 (merchant/order)</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Merchant ID invalido ou revogado.</li>
                  <li>Pedido nao pertence a esta loja.</li>
                  <li>Confirme o ID do pedido retornado no GET.</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Erro 400 (payload)</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Faltou `status`, `courierId` ou `paymentMethod`.</li>
                  <li>Verifique se o JSON esta valido.</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Erro 500</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Consulte Logs de Erro (fonte: qualifaz).</li>
                  <li>Repetir a chamada com o mesmo header.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Prompt IA para homologacao</h2>
            <p className="mt-2 text-sm text-slate-600">
              Copie o bloco abaixo e envie para sua IA. Ele ja contem contexto, regras e entregas esperadas.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-900 p-5 text-xs text-emerald-200">
{`Contexto:
Voce esta integrando a plataforma Qualifaz Entregas com a API do MenuFaz.
Base URL: https://app.menufaz.com/api
Autenticacao: header obrigatório "x-merchant-id: <UUID>"

Objetivo:
- Listar pedidos do MenuFaz.
- Atualizar status e campos operacionais (pagamento, chat, reembolso, courier).

Regras:
1) Todas as chamadas devem enviar o header x-merchant-id.
2) Use JSON em todas as requisicoes.
3) Respeitar status: PENDING, PREPARING, WAITING_COURIER, DELIVERING, COMPLETED, CANCELLED.
4) Para cancelar, enviar { status: "CANCELLED", reason: "<motivo>" }.
5) Datas em ISO-8601. Polling recomendado: 5-15s.
6) Tratar 400 (bad request) e 404 (merchant/order nao encontrado).
7) Tratar 500 e registrar logs com codigo de erro quando houver falha.
8) Ler o campo "type" para distinguir DELIVERY, PICKUP ou TABLE.
9) Para pedidos PICKUP, não usar WAITING_COURIER (use DELIVERING como "pronto para retirada").
10) paymentMethod retorna string descritiva (Pix, Dinheiro, Cartao, Pagamento na mesa).
11) Campos opcionais: deliveryAddress so para DELIVERY; tableNumber/tableSessionId so para TABLE; pickup/isPickup true para PICKUP.

Endpoints:
- GET /qualifaz/cancel-reasons
- GET /qualifaz/orders
- GET /qualifaz/orders/:id
- PUT /qualifaz/orders/:id/status
- PUT /qualifaz/orders/:id/payment
- PUT /qualifaz/orders/:id/refund
- PUT /qualifaz/orders/:id/chat
- PUT /qualifaz/orders/:id/courier-stage
- PUT /qualifaz/orders/:id/assign

Store API:
- GET /stores/:id/availability
- PUT /stores/:id/schedule
- PUT /stores/:id/auto-open
- PUT /stores/:id/auto-accept
- POST /stores/:id/pause
- DELETE /stores/:id/pause
- GET /stores/:id/company-profile

Filtros:
- GET /qualifaz/orders?status=PENDING
- GET /qualifaz/orders?since=2025-01-01T00:00:00Z

Cancelamento (modelos):
- GET /qualifaz/cancel-reasons (retorna lista oficial de motivos)

Mapeamento de status:
- PENDING: pedido novo aguardando confirmacao
- PREPARING: em preparo na cozinha
- WAITING_COURIER: aguardando motoboy (na retirada use DELIVERING)
- DELIVERING: saiu para entrega / pronto para retirada
- COMPLETED: entregue/concluido
- CANCELLED: cancelado (enviar reason)

Modelo de resposta (exemplo resumido):
{
  "id": "UUID",
  "status": "PENDING",
  "storeId": "UUID",
  "storeName": "Loja Exemplo",
  "userId": "UUID",
  "customerId": "UUID",
  "storeCity": "Cidade",
  "createdAt": "2025-01-01T12:00:00Z",
  "time": "12:00:00",
  "type": "DELIVERY",
  "pickup": false,
  "isPickup": false,
  "notes": "Sem cebola",
  "customerName": "Nome",
  "customerPhone": "11999999999",
  "deliveryFee": 5,
  "tableNumber": null,
  "tableSessionId": null,
  "deliveryAddress": {
    "street": "Rua X",
    "number": "123",
    "district": "Centro",
    "city": "Cidade",
    "state": "UF",
    "complement": "Apto 12"
  },
  "storeAddress": {
    "street": "Rua Loja",
    "number": "50",
    "district": "Centro",
    "city": "Cidade",
    "state": "UF",
    "complement": ""
  },
  "storeCoordinates": { "lat": -23.55, "lng": -46.63 },
  "deliveryCoordinates": { "lat": -23.56, "lng": -46.64 },
  "items": ["1x Produto (Extras) [Obs: pouco sal]"],
  "lineItems": [
    {
      "productId": "UUID",
      "name": "Produto",
      "quantity": 1,
      "unitPrice": 10.5,
      "totalPrice": 10.5,
      "options": [{ "groupName": "Extras", "optionName": "Queijo", "price": 2 }]
    }
  ],
  "total": 10.5,
  "paymentMethod": "Pix",
  "refundStatus": "NONE",
  "refundReason": null,
  "cancelReason": null,
  "chat": [],
  "courierId": "UUID",
  "courierStage": "ASSIGNED",
  "cpf": "00000000000"
}

Exemplos de payload:
- Status: { "status": "PREPARING" }
- Cancelamento: { "status": "CANCELLED", "reason": "Item indisponivel" }
- Pagamento: { "paymentMethod": "PIX" }
- Reembolso: { "refundStatus": "APPROVED", "refundReason": "Item indisponivel" }
- Chat: { "chat": [{ "from": "store", "message": "Pedido em preparo" }] }
- Courier stage: { "stage": "TO_CUSTOMER" }
- Assign courier: { "courierId": "UUID" }
- Auto-aceite: { "enabled": true }
- Auto-abertura: { "enabled": true }
- Pausa: { "minutes": 30, "reason": "Pausa operacional" }

Modelo de erro (resposta):
{ "error": "merchant not found", "code": "QUALIFAZ_MERCHANT_NOT_FOUND" }

Codigos de erro:
- QUALIFAZ_MERCHANT_ID_REQUIRED
- QUALIFAZ_MERCHANT_NOT_FOUND
- QUALIFAZ_ORDER_NOT_FOUND
- QUALIFAZ_STATUS_REQUIRED
- QUALIFAZ_COURIER_ID_REQUIRED
- QUALIFAZ_STAGE_REQUIRED
- QUALIFAZ_PAYMENT_METHOD_REQUIRED
- QUALIFAZ_INTERNAL_ERROR

Cancelamento (exemplo de resposta):
{
  "reasons": [
    { "code": "CUSTOMER_REQUEST", "label": "Cliente pediu cancelamento" }
  ]
}

Exemplo de availability (resposta):
{
  "storeId": "UUID",
  "isOpen": false,
  "reason": "PAUSED",
  "scheduleOpen": true,
  "autoOpenClose": true,
  "pause": { "active": true, "reason": "Pausa operacional", "endsAt": "2025-01-01T12:30:00Z" },
  "nextChangeAt": "2025-01-01T12:30:00Z"
}

Exemplo de company profile (resposta):
{
  "storeId": "UUID",
  "store": { "name": "Loja Exemplo", "cnpj": "00000000000000", "city": "Cidade" },
  "owner": { "id": "UUID", "name": "Responsavel", "email": "responsavel@loja.com" }
}

Entregas esperadas:
- Servico/cliente HTTP para consumir a API.
- Funcoes: listarPedidos(), buscarPedido(id), atualizarStatus(id, status, motivo?), atualizarPagamento(id, metodo),
  atualizarReembolso(id, status, motivo), atualizarChat(id, mensagens), atualizarEtapaCourier(id, etapa),
  atribuirCourier(id, courierId).
- Logs de sucesso/erro, incluindo codigo de erro quando houver falha.
- Validacao de resposta de erro no formato { error, code }.
`}
            </pre>
          </div>

          <div className="mt-14 rounded-[32px] border border-slate-200 bg-gradient-to-r from-[#0c5b4a] via-[#0c5b4a] to-[#1f8a6d] p-8 text-white shadow-2xl">
            <h2 className="text-2xl font-bold">Pronto para homologar?</h2>
            <p className="mt-2 text-sm text-white/80 max-w-2xl">
              Gere o Merchant ID, valide o header e confirme que sua integracao consegue ler e atualizar
              pedidos em tempo real.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiDocs;
