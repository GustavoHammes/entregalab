# Permissoes e isolamento de projetos

O EntregaLab combina **vinculo ao projeto** com **papel nesse projeto**. Autenticacao identifica a conta; autorizacao decide o que ela pode fazer naquele recurso. Nao basta possuir um JWT valido nem conhecer um UUID.

## Matriz de acesso

| Acao | Lider (`leader`) | Membro (`member`) | Fora do projeto |
| --- | --- | --- | --- |
| Ler tarefas, comentarios, equipe e progresso | Sim | Sim | Nao |
| Criar, editar, mover e excluir tarefas | Sim | Sim | Nao |
| Comentar tarefas | Sim | Sim | Nao |
| Editar ou excluir o projeto | Sim | Nao | Nao |
| Adicionar ou remover membros | Sim | Nao | Nao |
| Remover o lider | Nao | Nao | Nao |

O criador recebe `leader`, equivalente ao owner desta versao. A mesma pessoa pode ser lider no projeto A e membro no B; o papel nao e global. O laboratorio apenas concede lideranca nos proprios exemplos, nao administracao de contas ou projetos de terceiros. Ainda nao existe transferencia de lideranca nem edicao de papeis pela API ou interface.

Todos os membros podem colaborar em todas as tarefas do projeto, independentemente de quem as criou ou de quem e o responsavel. Reabrir uma tarefa concluida e permitido. Essa escolha atende equipes pequenas; nao ha papel de observador nem fluxo de aprovacao exclusivo do lider.

## Validacao no servidor

- Cada rota com `projectId` exige sessao e consulta `project_members` com o ID autenticado. O servidor nao aceita `userId` ou `role` enviados pelo navegador como identidade.
- Operacoes sobre tarefas verificam **juntos** `project_id` e `taskId`. Um membro dos dois projetos tambem nao pode combinar a URL de um com a tarefa do outro. Comentarios passam pela mesma verificacao.
- O responsavel deve pertencer ao projeto. `beforeId` precisa apontar para uma tarefa do mesmo projeto e da coluna de destino. Falhas revertem toda a transacao, inclusive notificacoes e progresso.
- Alterar `role`, `createdBy` ou `projectId` pelo corpo de uma requisicao nao concede privilegios: os schemas rejeitam campos desconhecidos.
- Sem sessao: `401`. Conta autenticada fora do projeto ou recurso de outro projeto: `404`, sem confirmar sua existencia. Membro tentando acao exclusiva do lider: `403`.
- Remover um membro elimina suas atribuicoes naquele projeto e bloqueia novas operacoes com a mesma sessao, sem exigir logout. Notificacoes daquele projeto deixam de ser acessiveis. Dados que ja foram entregues ao navegador nao podem ser recolhidos retroativamente.

## Concorrencia

Escritas em tarefas, comentarios, projeto e equipe usam transacoes e `SELECT ... FOR UPDATE` na linha do projeto. A autorizacao e consultada **novamente depois de obter o lock**, usando a mesma conexao da transacao. Assim, uma acao que ficou aguardando nao usa uma permissao antiga caso uma revogacao ou mudanca de papel tenha sido confirmada antes de sua vez.

Movimentos concorrentes no mesmo projeto sao serializados. Duas mudancas validas no mesmo card seguem a ordem de execucao no banco: a ultima prevalece. Isso preserva a integridade, mas nao e deteccao de edicao desatualizada: nao existe controle otimista com versao/ETag nem resposta `409` por conflito de edicao nesta versao.

Se uma acao ja adquiriu o lock e foi autorizada, ela pode concluir antes da revogacao que esta esperando. A remocao posterior bloqueia as proximas escritas. Projetos distintos usam linhas diferentes e nao precisam esperar o mesmo lock.

## Evidencias automatizadas

`apps/api/test/authorization.test.ts` testa com PostgreSQL real:

- Todas as 13 rotas de projeto/tarefa/equipe/progresso, sem sessao e com usuario externo.
- Diferenca entre lider e membro, inclusive uma conta lider em um projeto e membro em outro.
- Troca de `projectId`, `taskId` e `beforeId`, comentarios de outro projeto e tentativas de elevar privilegios pelo corpo.
- Revogacao de todas as rotas e atribuicoes apos remover um membro, mantendo sua sessao valida.
- Movimentos simultaneos feitos por contas diferentes, posicoes unicas por coluna e progresso consistente.
- Edicoes concorrentes de status no mesmo card, sem duplicacao de tarefas.
- Escritas aguardando um lock enquanto o membro e removido, o papel e alterado diretamente no banco de teste ou o projeto e excluido.

Os testes de corrida observam `pg_blocking_pids` para confirmar que a requisicao esta realmente bloqueada antes de alterar a permissao; nao presumem ordem usando uma espera fixa. As mudancas diretas de papel sao fixtures de teste, nao uma funcionalidade publica de transferencia de lideranca.

Execute no banco temporario separado:

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down
```

Essa cobertura reduz riscos conhecidos de autorizacao e concorrencia; nao equivale a uma auditoria de seguranca completa.
