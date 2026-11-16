# StreamHub

[![Última versão](https://img.shields.io/github/v/release/leozinwf/streamhub?label=vers%C3%A3o)](https://github.com/leozinwf/streamhub/releases/latest)
[![Licença: GPL v3](https://img.shields.io/badge/licen%C3%A7a-GPL--3.0-blue)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/leozinwf/streamhub/total?label=downloads)](https://github.com/leozinwf/streamhub/releases)

**Player de IPTV para Windows e navegador, com visual inspirado no YouTube.**
Use a sua própria lista M3U ou o seu acesso IPTV e assista aos seus canais, filmes e séries numa interface
organizada, com recomendações, guia de programação e um player completo.

**[⬇️ Baixar a versão mais recente](https://github.com/leozinwf/streamhub/releases/latest)**

> O StreamHub é **apenas um player**. Ele não vem com canais, listas ou conteúdo de nenhum tipo:
> cada pessoa usa a lista ou o acesso IPTV que já possui. Use o StreamHub somente com conteúdo
> que você tenha autorização para acessar.

---

## Download e instalação (Windows)

Na página de [Releases](https://github.com/leozinwf/streamhub/releases/latest) há dois arquivos:

| Arquivo | Para quem | Atualização |
|---|---|---|
| `StreamHub-Instalador-<versão>.exe` | **Recomendado.** Instala e cria atalhos na área de trabalho e no menu Iniciar. | Automática: o app baixa a versão nova e pergunta se pode reiniciar. |
| `StreamHub-Portatil-<versão>.exe` | Roda sem instalar (por exemplo, num pendrive). | O app avisa quando sai versão nova e abre a página de download. |

Os dois guardam a lista e as preferências no mesmo lugar, então dá para trocar de um para o outro.

### O Windows bloqueou ou "não aconteceu nada" ao abrir?

O StreamHub ainda não tem assinatura digital, então o Windows pode barrar o arquivo baixado:

1. Clique com o botão direito no arquivo baixado → **Propriedades**.
2. Na aba **Geral**, marque **Desbloquear** (no rodapé) → **OK**.
3. Abra de novo. Se aparecer **"O Windows protegeu o computador"**, clique em **Mais informações → Executar assim mesmo**.

Se ainda assim não abrir: **Segurança do Windows → Proteção contra vírus e ameaças → Histórico de proteção**,
encontre o StreamHub e clique em **Ações → Permitir**.

---

## Recursos

**Biblioteca no estilo YouTube**
- Página inicial com fileiras por tipo: TV Aberta, Esportes, Streaming e eventos (Disney+, Max, Prime…), Filmes e séries,
  Documentários, Variedades, Notícias, Infantil e outros, com as principais marcas primeiro.
- Busca de canais, filmes e séries que ignora acentos (atalho <kbd>/</kbd>).
- Canais brasileiros separados dos internacionais, que ficam numa categoria própria.
- Categorias organizadas automaticamente ou do jeito que vieram da sua lista, sem o prefixo "Canais |".
- Versões do mesmo canal (Full HD, HD, SD…) agrupadas num único cartão. O H265 nunca é a versão principal,
  porque muitos computadores não reproduzem esse formato.
- Favoritos, vistos recentemente (com opção de limpar) e "Continuar assistindo".
- Filmes e séries (catálogo do IPTV), com lista de episódios.

**Player**
- Barra de controles como a do YouTube: play/pause, voltar e avançar 10 s, volume, tela cheia, miniplayer (PiP) e modo teatro.
- **Pausar e voltar no ao vivo:** o player guarda o que já passou, e o botão **Ao vivo** volta para o tempo real.
- Menu de configurações: qualidade, velocidade e formato da imagem.
- Painel **Recomendados** ao lado do player: outros canais da mesma marca (ESPN 2, ESPN 3…) e do mesmo tipo.
- Guia de programação (EPG) do canal, quando o IPTV fornece.
- Mosaico para assistir até 4 canais ao mesmo tempo.
- Suporte a HLS (`.m3u8`), MPEG-TS (`.ts`) e vídeos diretos (`.mp4`, `.mkv`…).

### Atalhos de teclado

| Tecla | Ação |
|---|---|
| <kbd>Espaço</kbd> ou <kbd>K</kbd> | Pausar / continuar |
| <kbd>←</kbd> <kbd>→</kbd> ou <kbd>J</kbd> <kbd>L</kbd> | Voltar / avançar 10 segundos |
| <kbd>↑</kbd> <kbd>↓</kbd> | Volume |
| <kbd>M</kbd> | Tirar / devolver o som |
| <kbd>F</kbd> | Tela cheia do player |
| <kbd>T</kbd> | Modo teatro |
| <kbd>/</kbd> | Pesquisar (página inicial) |
| <kbd>F11</kbd> / <kbd>F5</kbd> | Tela cheia da janela / recarregar (app para Windows) |

---

## Como usar

Ao abrir pela primeira vez, conecte a sua lista de um destes jeitos:

- **Arquivo M3U:** escolha um arquivo `.m3u` ou `.m3u8` do computador.
- **URL M3U:** cole o link da sua lista.
- **Acesso IPTV:** informe servidor, usuário e senha (padrão Xtream Codes). Por esse caminho também aparecem
  o catálogo de **filmes e séries** e o **guia de programação**.

A lista fica salva no próprio computador. Para trocar de lista, use **Importar** no topo. Para apagar tudo, use **Sair**.

### Privacidade

- A lista, o login do IPTV, os favoritos e as preferências ficam **só no seu computador**
  (armazenamento local do app/navegador). Não existe conta nem banco de dados do StreamHub.
- Os streams passam por um pequeno servidor interno, que roda na sua própria máquina dentro do app e só
  repassa as requisições ao seu provedor (necessário porque muitos servidores IPTV não permitem acesso direto pelo navegador).

---

## Para desenvolvedores

### Requisitos

- [Node.js](https://nodejs.org/) 20 ou mais recente
- Windows, para gerar o instalador `.exe`

### Rodando localmente

```bash
npm install
npm run dev        # http://localhost:5173 (ou dois cliques em "npm run dev.bat")
```

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Vite) com a API local |
| `npm run build` | Checagem de tipos + build de produção em `dist/` |
| `npm run lint` | Checagem de tipos (TypeScript) |
| `npm start` / `npm run serve` | Servidor de produção (Express) / build + servidor. Porta pela variável `PORT` (padrão 3000) |
| `npm run desktop` | Abre o app desktop (Electron) sem gerar instalador |
| `npm run desktop:exe` | Gera instalador e versão portátil em `release/`, sem publicar |
| `npm run desktop:release` | Gera e publica no GitHub Releases (precisa de `GH_TOKEN`) |

### Estrutura

```
src/
  App.tsx                 Telas de TV ao vivo, filmes e séries, painel lateral, EPG
  components/
    HomeFeed.tsx          Página inicial estilo YouTube (fileiras, chips, menu lateral)
    Player.tsx            Player (HLS/MPEG-TS), controles, ao vivo com pausa, qualidade
    Mosaic.tsx            Mosaico de até 4 canais
  lib/
    m3u.ts                Leitura de listas M3U
    categorize.ts         Categorias inteligentes e separação Brasil × internacionais
    channelVariants.ts    Agrupamento de versões (FHD/HD/SD/H265) de um mesmo canal
    recommend.ts          Recomendações de canais parecidos
    storage.ts            Lista salva no IndexedDB
api/                      Rotas: proxy de streams, playlist por URL, Xtream, exportação M3U
server/
  app.ts                  Servidor Express (front-end + /api), usado pela web e pelo desktop
  index.ts                Ponto de entrada do deploy web
electron/main.cjs         App desktop: liga o servidor interno e abre a janela; atualização automática
scripts/                  Empacotamento do desktop e criação das releases
build/                    Ícones e texto padrão das notas de release
```

### App desktop e publicação de versões

O app desktop (Electron) liga o mesmo servidor do deploy web em `http://127.0.0.1:51730` e o mostra numa janela.
A porta é fixa porque a lista e as preferências ficam salvas por endereço.

Para publicar uma versão nova, dê dois cliques em **`Publicar nova versao.bat`**. Ele:

1. pede um token do GitHub na primeira vez (permissão `public_repo`), salvo em `.gh-token`, que fica fora do Git;
2. pergunta o tipo de versão (correção, novidade ou republicar a atual);
3. oferece fazer commit e push;
4. pergunta as novidades da versão (itens separados por `;`) e cria a release com as notas de
   `build/release-notes.md`;
5. gera o instalador e a versão portátil e envia os arquivos para o GitHub.

Os apps instalados verificam atualizações ao abrir e a cada 4 horas.

### Segurança das dependências

- Verificar: `npm audit` (o esperado é `found 0 vulnerabilities`). Corrigir o que for compatível: `npm audit fix`.
- O `package.json` tem `overrides` para o `minimatch`: o `electron-builder` ainda usa as versões 9.x/10.x,
  vulneráveis (GHSA-g3hv-75wg-m249), que são trocadas pela 11.x corrigida. As versões 3.x/5.x, usadas por
  outras partes e não afetadas, continuam como estão. Quando o `electron-builder` atualizar essa dependência,
  os `overrides` podem ser removidos.

### Tecnologias

React 18 · TypeScript · Vite · hls.js · mpegts.js · Express · Electron · electron-builder · electron-updater

---

## Contribuindo

O StreamHub é open source e contribuições são bem-vindas: relatar problemas, sugerir ideias ou enviar código.
Veja o [guia de contribuição](CONTRIBUTING.md) e use as [Issues](https://github.com/leozinwf/streamhub/issues) para falar com o projeto.

## Licença

Copyright © 2026 Leonardo Morais.

O StreamHub é software livre: você pode usar, estudar, modificar e redistribuir o código nos termos da
[GNU General Public License v3.0 ou posterior](LICENSE). Versões modificadas que forem distribuídas também
precisam ter o código aberto, sob a mesma licença.

