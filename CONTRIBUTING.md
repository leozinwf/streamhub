# Como contribuir com o StreamHub

Obrigado pelo interesse! O StreamHub é open source (GPL-3.0) e toda ajuda é bem-vinda:
relatar problemas, sugerir ideias, melhorar a documentação ou enviar código.

## Relatando problemas e sugerindo ideias

Use a aba [Issues](https://github.com/leozinwf/streamhub/issues) e escolha o modelo
**Problema** ou **Sugestão**.

> ⚠️ **Nunca publique** o link da sua lista M3U, o servidor, o usuário ou a senha do seu IPTV.
> As issues são públicas. Se precisar mostrar o nome de um canal ou grupo, tudo bem; credenciais, não.

## Enviando código

1. Faça um *fork* do repositório e crie uma branch a partir da `main`:
   `git checkout -b minha-melhoria`
2. Instale e rode o projeto:
   ```bash
   npm install
   npm run dev
   ```
3. Faça as mudanças e confira, antes de enviar:
   - `npm run lint`: sem erros de TypeScript;
   - `npm run build`: o build de produção funciona;
   - `npm audit`: nenhuma vulnerabilidade nova.
4. Abra um *Pull Request* descrevendo o que mudou e por quê. Se for mudança visual, inclua prints.

### Boas práticas do projeto

- **Interface em português (pt-BR).** Textos para o usuário em português, simples e diretos.
- **Sem conteúdo embutido.** O StreamHub é só o player: não adicione listas, canais, links de streams
  ou qualquer conteúdo de terceiros ao repositório.
- **Privacidade em primeiro lugar.** Dados do usuário (lista, credenciais, preferências) ficam no
  dispositivo dele. Não adicione rastreamento, analytics ou envio de dados para servidores externos.
- **Mudanças pequenas e focadas.** Um Pull Request por assunto facilita a revisão.

## Licença

Ao contribuir, você concorda que a sua contribuição será licenciada sob a
[GNU GPL v3.0 ou posterior](LICENSE), a mesma licença do projeto.
