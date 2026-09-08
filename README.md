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
