# StreamHub

Player web para playlists M3U, com foco em uso local no navegador.

## Stack

- React + TypeScript + Vite
- HLS.js (próxima etapa do player)
- LocalStorage no MVP
- Sem banco de dados

## MVP atual

- Importação de arquivo `.m3u` / `.m3u8`
- Parsing de `#EXTINF` e grupos
- Busca de canais
- Navegação por categorias
- Persistência local da playlist
- Interface responsiva

## Desenvolvimento

```bash
npm install
npm run dev
```

## Próximas etapas

1. Conectar o player HLS real.
2. Adicionar suporte a URL de playlist com tratamento de CORS quando a fonte permitir.
3. Favoritos e histórico persistidos localmente.
4. Importação de EPG/XMLTV.
5. PWA e experiência para telas maiores.

Use o projeto apenas com playlists e streams que você tenha autorização para acessar.

## App para Windows (.exe)

O StreamHub também roda como programa de desktop (Electron), sem precisar de `npm run dev`,
e se atualiza sozinho pelas *Releases* do GitHub.

- **Publicar uma versão nova:** dois cliques em `Publicar nova versao.bat`
  (ou `npm version patch --no-git-tag-version` + `npm run desktop:release` com `GH_TOKEN` definido).
  Ele aumenta a versão, gera o instalador e publica em https://github.com/leozinwf/streamhub/releases.
  Na primeira vez pede um token do GitHub (permissão `public_repo`), salvo em `.gh-token` (fora do Git).
- **Atualização automática:** o app instalado verifica novas versões ao abrir e a cada 4 horas,
  baixa em segundo plano e oferece reiniciar. Se o usuário escolher "Depois", instala ao fechar.
- **Gerar só um instalador local (sem publicar):** `Gerar StreamHub.exe.bat` ou `npm run desktop:exe`.
- **Testar sem instalador:** `npm run desktop`.

Como funciona: `electron/main.cjs` é empacotado com o servidor (`server/app.ts`, o mesmo do deploy web)
e o `electron-updater` em `electron/app/main.cjs`. Ao abrir, liga o servidor em `http://127.0.0.1:51730`
e mostra a janela. A porta é fixa porque a playlist e as preferências ficam salvas por endereço.
