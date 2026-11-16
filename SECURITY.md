# Política de segurança

## Versões com suporte

Apenas a **versão mais recente** publicada em [Releases](https://github.com/leozinwf/streamhub/releases/latest)
recebe correções de segurança. O app instalado se atualiza sozinho. Na versão portátil, baixe a versão nova
quando o app avisar.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança.

Use o recurso de relato privado do GitHub:
[**Report a vulnerability**](https://github.com/leozinwf/streamhub/security/advisories/new)
(aba *Security* → *Report a vulnerability*).

Inclua, se possível:
- o que a falha permite fazer e qual o impacto;
- passos para reproduzir (ou uma prova de conceito);
- a versão do StreamHub e como você usa (app instalado, portátil ou navegador).

> Nunca envie o link da sua lista, o servidor, o usuário ou a senha do seu IPTV no relato.

## O que esperar

- Confirmação de recebimento em até **7 dias**.
- Correção publicada numa nova versão assim que possível, com crédito a quem reportou (se desejar).

## Escopo

Interessam principalmente falhas no player, no servidor interno que repassa os streams (`/api`),
no app desktop (Electron) e no processo de atualização automática.
Problemas com listas, canais ou servidores IPTV de terceiros estão fora do escopo do projeto.
