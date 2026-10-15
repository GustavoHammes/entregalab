# Publicacao gratuita: Render + Neon

O mesmo Dockerfile usado no WSL funciona no Render. A API serve o React compilado e usa o PostgreSQL do Neon. Isso evita configurar dois dominios, CORS entre provedores ou armazenamento de tarefas no navegador.

## 1. Criar o repositorio no GitHub

Repositorio escolhido: https://github.com/GustavoHammes/entregalab, branch `main`.

Servico criado no workspace `Gustavo Hammes's Workspace`: `entregalab`, Docker, plano Free, regiao Ohio, deploy automatico da branch `main`.

- Painel: https://dashboard.render.com/web/srv-db76o8ks728c73dklohg
- URL reservada: https://entregalab-yoes.onrender.com
- O site so fica operacional depois de configurar `DATABASE_URL` e o deploy atingir `live`.

1. Abra https://github.com/new usando sua conta.
2. Nome sugerido: `entregalab`.
3. Escolha **Private** inicialmente. Pode mudar para publico depois para o portfolio.
4. Nao adicione README, .gitignore ou licenca no formulario, pois os arquivos ja estao neste projeto.
5. Clique em **Create repository** e envie o link do repositorio para continuar a publicacao.

Nao publique `.env`, `.env.production`, dumps de backup ou senhas. O `.gitignore` ja exclui esses arquivos. As capturas de QA ficam em `.codex-logs` e tambem sao ignoradas.

## 2. Criar o banco no Neon

Projeto identificado: `icy-water-05832518` (`entregalab`), branch `br-flat-frog-b5yx8vvh` (`production`), banco `neondb`, PostgreSQL 18, regiao AWS Ohio (`aws-us-east-2`). Para o Render, escolha a regiao `ohio`.

A variavel `DATABASE_URL` precisa da connection string que comeca com `postgresql://`. Uma chave de API do Neon ou uma chave primaria de tabela nao substitui essa conexao. O codigo usa `pg` para abrir a conexao PostgreSQL.

No servico ja criado, abra **Environment > Add Environment Variable**, use a chave `DATABASE_URL`, cole a string do Neon e salve com redeploy. `JWT_SECRET` ja foi gerado e configurado no Render; nao substitua por uma senha pessoal. `NODE_ENV=production`, `SECURE_COOKIES=true` e `TRUST_PROXY=true` tambem estao configurados. Use **Settings > Health Check Path** para definir `/health` se o painel permitir.

1. Abra https://console.neon.tech e crie sua conta.
2. Crie um projeto chamado `entregalab` no plano **Free**.
3. Escolha uma regiao proxima da regiao usada no Render.
4. No painel **Connect**, escolha o banco e o usuario do projeto. Ative **Connection pooling**.
5. Copie a connection string PostgreSQL, que termina com parametros como `sslmode=require`. Preserve esses parametros para manter TLS com verificacao do certificado.
6. Guarde a string para cadastrar no Render. Ela inclui a senha do banco; nao coloque no repositorio ou em capturas publicas.

Nao e necessario importar o SQL manualmente: a aplicacao executa a migracao inicial ao iniciar e registra a versao em `schema_migrations`. Uma instalacao com o schema anterior e adotada sem apagar seus dados.

## 3. Publicar no Render

1. Com o codigo enviado ao GitHub, abra https://dashboard.render.com.
2. Use **New > Blueprint** e conecte apenas o repositorio deste projeto.
3. O Render detecta `render.yaml`, com um servico Docker no plano **free**.
4. Na variavel `DATABASE_URL`, cadastre a connection string do Neon no painel do Render.
5. `JWT_SECRET` sera gerado pelo Render. `SECURE_COOKIES=true` e `TRUST_PROXY=true` ja estao no blueprint.
6. Inicie o deploy e aguarde a verificacao de `/health`. O Render define `PORT` e o servidor respeita essa variavel.
7. Abra o endereco HTTPS gerado e crie sua conta na aplicacao. Cada conta recebe um projeto inicial privado.

Para experimentar antes de cadastrar uma conta, clique em `Testar como administrador`. O laboratorio tera dois projetos e 12 tarefas, com dados exclusivos da sessao. Na sua conta normal, a opcao `Laboratorio` permite carregar os mesmos exemplos sem alterar projetos pessoais.

Se preferir **New > Web Service**, conecte o mesmo repositorio, escolha runtime **Docker**, plano **Free**, Dockerfile `./Dockerfile` e health check `/health`. Cadastre as mesmas variaveis do `render.yaml` e gere um `JWT_SECRET` aleatorio de pelo menos 32 caracteres.

Para continuar com ajuda, informe o link do repositorio e confirme quando o projeto no Neon estiver criado. A string do banco pode ser inserida diretamente no Render por voce; senhas pessoais de GitHub, Render e Neon nao sao necessarias.

## Uso e limites

Verificado em 13/10/2026: o [Neon Free](https://neon.com/pricing) oferece 1 GB por projeto e 100 CU-horas mensais por projeto, sem prazo fixo ou cartao obrigatorio. As quotas podem mudar.

O [Render Free](https://render.com/docs/free) entra em repouso depois de 15 minutos sem trafego. A primeira abertura pode levar cerca de um minuto, e ha limites mensais de uso. O provedor recomenda planos pagos para producao. Esta opcao gratuita atende uso pessoal e demonstracoes com essas restricoes, sem garantia de disponibilidade continua para atividades criticas do trabalho.

Use o Neon para persistencia: o PostgreSQL gratuito do Render expira apos 30 dias. Nao crie um banco Render Free para guardar suas tarefas a longo prazo. No Render, manter o plano Free e nao cadastrar forma de pagamento evita cobrancas por excedentes; o servico pode ser suspenso ao atingir limites.

O deploy externo e uma instalacao separada do WSL. Os dados locais nao sao copiados automaticamente para a nuvem. Para migrar dados reais, faca um dump e restaure antes de usar a nova instalacao.

## Conferir depois do deploy

O envio opcional de emails usa Gmail API na propria API, sem SMTP ou Vercel. Siga [EMAIL.md](EMAIL.md) para criar credenciais OAuth, definir o administrador pelo ID e conectar o Gmail; nao reutilize senhas de aplicativo. O site e as notificacoes internas continuam funcionando com o envio desligado.

- `/health` retorna `{"status":"ok","database":"ok"}`.
- Cadastro e login funcionam pelo HTTPS.
- Uma tarefa criada aparece no Board, na List e nas metricas do Dashboard.
- Recarregar a pagina preserva as tarefas e a sessao.
- Outro usuario so ve o projeto depois de ser adicionado pelo lider.
- Movimentos, filtros, comentarios e exclusao funcionam.

## Backup do banco hospedado

Use `pg_dump` com uma versao compativel com a versao principal do PostgreSQL do Neon. No Ubuntu, leia a string pela entrada do terminal para evitar gravar a senha no historico:

```bash
read -rsp 'Connection string do Neon: ' DATABASE_URL; echo
export DATABASE_URL
pg_dump --dbname="$DATABASE_URL" -Fc -f entregalab-neon.dump
unset DATABASE_URL
```

Guarde o dump fora do repositorio. Ele contem os dados dos usuarios. Teste uma restauracao em outro banco antes de depender do backup.
