# Gmail API no Render

O EntregaLab envia emails pelo HTTPS da Gmail API, sem SMTP, Vercel ou dominio proprio. Uma unica conta Gmail e o remetente do sistema. Os colegas recebem no email cadastrado; eles nao precisam conectar a propria conta Google.

O envio permanece desligado ate a configuracao e a autorizacao abaixo. Nao use `GMAIL_APP_PASS`. Revogue qualquer senha de aplicativo exposta em capturas ou mensagens.

## 1. Criar o projeto Google

1. Abra <https://console.cloud.google.com/> com a conta que administrara a integracao e crie um projeto chamado `EntregaLab`.
2. Em **APIs e servicos > Biblioteca**, habilite **Gmail API**.
3. Em **Google Auth Platform**, configure o nome `EntregaLab`, seu email de suporte e seu contato de desenvolvedor.
4. Em **Audience/Publico**, escolha **External/Externo** e, enquanto estiver em **Testing/Teste**, adicione a conta Gmail remetente como usuario de teste.
5. Em **Data Access/Acesso a dados**, adicione somente `https://www.googleapis.com/auth/gmail.send`, `openid` e `email`. Nao e necessario ler mensagens, contatos ou anexos.
6. Em **Clients/Clientes**, crie um cliente OAuth do tipo **Web application/Aplicativo da Web**, chamado `EntregaLab Render`.
7. Adicione este **URI de redirecionamento autorizado**, exatamente:

```text
https://entregalab-yoes.onrender.com/api/email/gmail/callback
```

Guarde o client ID e o client secret de forma privada. Nao coloque os valores no GitHub, em capturas ou no chat. Nao precisa de chave de API Google nem de senha de aplicativo Gmail.

O link acima e desta instalacao. Para outra hospedagem, substitua pela origem HTTPS correspondente. Para desenvolvimento, registre tambem o callback da API, por exemplo `http://localhost:3333/api/email/gmail/callback`, e use essa origem em `APP_URL` com o frontend servido na mesma origem ou um proxy equivalente. O Compose de producao local pode usar `http://localhost:8080/api/email/gmail/callback`.

## 2. Configurar o Render

Entre na sua conta normal do EntregaLab, nao na demonstracao. Estando logado, abra <https://entregalab-yoes.onrender.com/api/auth/me> e encontre o valor de `user.id`. Esse UUID identifica o unico administrador que pode conectar, desconectar ou retomar envios. Definir o administrador pelo ID evita confiar apenas em um email cadastrado sem confirmacao.

No servico <https://dashboard.render.com/web/srv-db76o8ks728c73dklohg>, abra **Environment** e configure:

| Variavel | Valor |
| --- | --- |
| `APP_URL` | `https://entregalab-yoes.onrender.com` |
| `EMAIL_ADMIN_USER_ID` | `user.id` da sua conta normal |
| `GMAIL_CLIENT_ID` | Client ID do cliente OAuth Google |
| `GMAIL_CLIENT_SECRET` | Client secret do cliente OAuth Google |
| `GMAIL_USER` | Email exato da conta Gmail remetente |
| `EMAIL_TOKEN_KEY` | Chave aleatoria de 32 bytes em hexadecimal, 64 caracteres, mantida em segredo |
| `EMAIL_MAX_PER_DAY` | `100`, limite conservador de tentativas por dia UTC |
| `EMAIL_ENABLED` | `true` |

Se `EMAIL_TOKEN_KEY` ja estiver configurada, preserve-a: alterar a chave exige conectar o Gmail novamente. Para uma nova instalacao, pode gerar a chave localmente com `openssl rand -hex 32` e informa-la apenas no Render. Nao altere `DATABASE_URL` ou `JWT_SECRET` para configurar email. O Render fornece `RENDER_EXTERNAL_URL`, usado como origem padrao quando `APP_URL` esta ausente.

Salve com redeploy e aguarde o servico ficar **Live**. Valores vazios de variaveis opcionais sao aceitos enquanto o envio estiver desligado.

## 3. Autorizar a conta remetente

1. Na conta administradora do EntregaLab, abra **Notificacoes > Email > Remetente do sistema**.
2. Clique em **Conectar Gmail**. O site abre a pagina oficial de autorizacao do Google.
3. Escolha a conta indicada em `GMAIL_USER` e revise as permissoes antes de autorizar. Essa acao permite enviar mensagens a partir dessa conta, mas nao solicita leitura da caixa de entrada.
4. O Google retorna ao EntregaLab, que mostra **Gmail conectado**.

O servidor valida a conta, o consentimento e um estado de uso unico vinculado a sua sessao, com PKCE. O refresh token fica criptografado com AES-256-GCM no Neon; ele nao aparece na interface, nos logs ou nas respostas da API. Client secret e chave de criptografia ficam nas variaveis privadas do Render. Todos os envios continuam dentro do processo da API no Render.

Se a sessao do EntregaLab expirar durante a autorizacao, entre novamente e reinicie o fluxo. Se o Google recusar a autorizacao, confira usuario de teste, Gmail API habilitada, escopos e URI de redirecionamento. Siga a verificacao solicitada pelo Google; nao desative protecoes da conta.

## 4. Confirmar destinatarios e ativar avisos

1. Cada pessoa abre **Notificacoes > Email** na propria conta e clica em **Enviar confirmacao**.
2. Abre o link recebido, entra na mesma conta do EntregaLab e clica em **Confirmar email**.
3. Ativa **Receber notificacoes por email**.

O link e de uso unico e expira em uma hora. Ha limite de uma solicitacao por minuto e tres por hora por conta. Confirmar o endereco nao ativa avisos automaticamente. As preferencias **Projetos e equipe**, **Tarefas e comentarios** e **Prazos e atrasos** controlam tambem os novos emails. Contas ficticias e projetos de exemplo nunca enviam emails, mesmo quando pertencem a uma conta real.

O envio e apenas de novas notificacoes criadas apos a opcao ser ativada; nao ha disparo retroativo da caixa de entrada. Eventos realizados pela propria pessoa normalmente nao avisam o autor. Os emails incluem o projeto, a atividade e um link para a caixa de entrada autenticada, nao uma pagina publica do projeto.

## Fila, disponibilidade e seguranca

- A notificacao e seu registro na fila sao gravados na mesma transacao. Falha de envio nao impede criar ou mover tarefas.
- A fila e persistida no Neon e processada a cada 30 segundos enquanto o servidor estiver acordado; nao existe outro servico pago ou cron externo.
- Antes do envio, o servidor confirma participacao no projeto, endereco confirmado, preferencias e prazo ainda relevante. Saida da equipe, tarefa concluida e notificacoes com mais de 48 horas cancelam envios pendentes aplicaveis.
- Sao feitas ate cinco tentativas, com espera crescente. Limites do Google provocam espera maior; autorizacao revogada pausa a fila e pede reconexao. Apenas codigos de erro genericos sao armazenados.
- O teto diario e compartilhado entre processos e conta tentativas reais de envio, inclusive confirmacoes e falhas. Ele nao substitui os limites do Gmail. Ao atingir o teto, a fila espera o proximo dia UTC.
- `Entregues ao Gmail` significa que a API aceitou a mensagem, nao que ela entrou na caixa principal. Confira spam e os limites da conta.
- Jobs usam lease e locks para impedir o processamento simultaneo. Ainda pode haver duplicata rara se o Gmail aceitar e o processo cair antes de gravar o sucesso no banco; nao existe garantia de entrega exatamente uma vez.
- `Tentar falhas novamente` retoma somente jobs em falha, sem reenviar os ja concluidos. `Desconectar` remove o token salvo e tenta revogar a autorizacao no Google; se a revogacao externa falhar, remova o acesso tambem nas configuracoes da conta Google.
- Links de confirmacao usam fragmento de URL para que o token nao seja incluido nos logs HTTP. Parametros OAuth tambem nao sao registrados nos logs da aplicacao.
- Dados terminais da fila sao removidos apos 30 dias; confirmacoes antigas e estados OAuth expirados tambem sao limpos.

**Render Free:** durante a suspensao por inatividade nao ha processamento. Lembretes por email nao tem horario exato garantido; a fila retoma quando a aplicacao volta a funcionar. Sem manter outro agendador, isso e uma limitacao da hospedagem escolhida.

**Google OAuth em Testing:** para um aplicativo externo com escopos Gmail, o refresh token expira normalmente depois de sete dias. Isso exige reconectar durante os testes. Antes de depender da integracao continuamente, configure o status de publicacao e siga os requisitos de verificacao aplicaveis no Google; apenas trocar o status nao garante aprovacao ou disponibilidade. Somente a conta remetente autoriza OAuth, nao todos os destinatarios.

## Referencias oficiais

- [OAuth para aplicacoes Web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Expiracao de refresh tokens](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API: envio](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [Limites do Gmail](https://support.google.com/mail/answer/22839)
- [Restricoes do Render Free](https://render.com/docs/free)
