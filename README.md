# MenuFaz

Aplicativo de delivery com frontend React + Vite e backend Node/Express conectado ao PostgreSQL. O deploy de producao usa Docker + Caddy (SSL automatico) e roda tudo no dominio `app.menufaz.com`.

## Stack
- Frontend: React + Vite + Tailwind CDN
- Backend: Node/Express
- Banco: PostgreSQL
- Deploy: Docker + Docker Compose + Caddy (SSL automatico)

---

# 1) Rodar localmente (dev)

## 1.1 Frontend
```bash
npm install
```

Crie `.env.local` com:
```bash
VITE_API_BASE_URL=http://localhost:3001/api
```

Inicie:
```bash
npm run dev
```

## 1.2 Backend (local)
```bash
cd backend
npm install
```

Crie `.env` dentro de `backend/`:
```bash
DATABASE_URL=postgres://menufaz:menufaz@localhost:5432/menufaz
JWT_SECRET=dev-secret
CORS_ORIGIN=http://localhost:5173
```

Suba o Postgres local e crie as tabelas:
```bash
psql -U postgres
CREATE DATABASE menufaz;
```
Depois rode o SQL de `backend/db/init.sql`.

Inicie a API:
```bash
npm start
```

---

# 2) Deploy em producao (Ubuntu 20.04)

## 2.1 Requisitos
- Dominio apontando para o servidor
  - `app.menufaz.com` -> IP do servidor

## 2.2 Instalar Docker
```bash
apt update && apt upgrade -y
apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu focal stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

## 2.3 Firewall
```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

## 2.4 Clonar o projeto
```bash
mkdir -p /opt/menufaz
cd /opt/menufaz
git clone https://github.com/dyingkasy/app.menufaz.git .
```

## 2.5 Criar `.env` para o Docker
Crie `/opt/menufaz/.env` com:
```bash
POSTGRES_PASSWORD=uma_senha_forte
JWT_SECRET=uma_chave_segura
```

## 2.6 Subir containers
```bash
docker compose up -d --build
```

Verificar status:
```bash
docker compose ps
```

Logs:
```bash
docker compose logs -f
```

---

# 3) Estrutura do deploy

## Docker Compose
- `postgres`: banco Postgres
- `api`: Node/Express (porta interna 3001)
- `frontend`: Vite build servido por Nginx (porta interna 8080)
- `caddy`: proxy reverso + SSL automatico

## Rotas
- `https://app.menufaz.com` -> frontend
- `https://app.menufaz.com/api` -> backend

---

# 4) Observacoes importantes

- SSL e renovacao automatica via Caddy.
- Para alterar o dominio, atualize `deploy/Caddyfile` e o build arg `VITE_API_BASE_URL` no `docker-compose.yml`.
- O arquivo `.env.example` mostra as variaveis necessarias.

---

# 5) Comandos uteis

Rebuild completo:
```bash
docker compose down
docker compose up -d --build
```

Atualizar codigo (pull + rebuild):
```bash
git pull
docker compose up -d --build
```
