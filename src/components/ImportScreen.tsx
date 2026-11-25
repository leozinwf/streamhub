import { useRef, useState } from 'react'
import { Eye, EyeOff, Link, LoaderCircle, Server, Tv, Upload } from 'lucide-react'
import type { Channel, Playlist } from '../types'
import { usePreference } from '../lib/preferences'
import { categorizeChannels } from '../lib/categorize'
import { MEDIA_CATALOG_VERSION } from '../lib/mediaCatalog'
import { createPlaylist, fetchXtream, loadMediaCatalog, normalizeServer } from '../lib/xtream'

type Props = {
  onImportFile: (file: File) => void
  /** Imports M3U text; returns when the playlist is saved. */
  onImportText: (name: string, content: string) => Promise<unknown>
  onConnected: (playlist: Playlist) => Promise<void>
}

/** First screen: import an M3U (file or URL) or log in to an Xtream IPTV account. */
export default function ImportScreen({ onImportFile, onImportText, onConnected }: Props) {
  const [mode, setMode] = usePreference('streamhub-connection-mode', 'm3u', ['m3u', 'xtream'] as const)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function importUrl() { const url = playlistUrl.trim(); if (!url) return; try { new URL(url) } catch { setUrlError('Informe uma URL válida.'); return }; setUrlLoading(true); setUrlError(null); try { const response = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`); if (!response.ok) throw new Error(await response.text()); await onImportText(new URL(url).hostname || 'Playlist por URL', await response.text()); setPlaylistUrl('') } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Não foi possível importar esta URL.') } finally { setUrlLoading(false) } }
  async function connectXtream() {
    const normalizedServer = normalizeServer(server)
    if (!normalizedServer || !username.trim() || !password.trim()) { setUrlError('Informe servidor, usuário e senha.'); return }
    setUrlLoading(true); setUrlError(null)
    try {
      const connection = { server: normalizedServer, username: username.trim(), password }
      const authResponse = await fetchXtream(connection)
      if (!authResponse.ok) { const data = await authResponse.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || 'Não foi possível autenticar.') }
      const auth = await authResponse.json() as { user_info?: { auth?: number; status?: string } }
      if (auth.user_info && (auth.user_info.auth === 0 || auth.user_info.status === 'Disabled')) throw new Error('A conta IPTV não está autorizada.')
      const [categoriesResponse, liveResponse] = await Promise.all([fetchXtream(connection, 'get_live_categories'), fetchXtream(connection, 'get_live_streams')]); if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')
      const categories = categoriesResponse.ok ? await categoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
      const categoryMap = new Map(categories.map((category) => [String(category.category_id), category.category_name || 'Outros']))
      const liveStreams = await liveResponse.json() as Array<{ stream_id?: number | string; name?: string; category_id?: number | string; category_name?: string; stream_icon?: string; container_extension?: string; epg_channel_id?: string | null }>
      const channels: Channel[] = categorizeChannels(liveStreams.filter((stream) => stream.stream_id != null && stream.name).map((stream, index) => { const extension = String(stream.container_extension || 'm3u8').toLowerCase().replace(/^\./, ''); const safeExtension = extension === 'ts' || extension === 'm3u8' ? extension : 'm3u8'; const originalGroup = categoryMap.get(String(stream.category_id)) || stream.category_name || 'Outros'; return { id: `xtream-${stream.stream_id}-${index}`, streamId: String(stream.stream_id), name: stream.name || 'Canal sem nome', url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.${safeExtension}`, group: originalGroup, sourceGroup: originalGroup, logo: stream.stream_icon || undefined, tvgId: String(stream.epg_channel_id ?? '').trim() } }))
      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')
      const media = await loadMediaCatalog(connection).catch(() => [])
      const next = { ...createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels), xtream: connection, media, mediaVersion: MEDIA_CATALOG_VERSION, mediaUpdatedAt: Date.now() }
      await onConnected(next)
    } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao serviço IPTV.') } finally { setUrlLoading(false) }
  }
  return <main className="landing"><section className="import-card"><div className="brand-mark"><Tv size={26} /></div><span className="eyebrow">STREAMHUB</span><h1>Sua playlist.<br /><span>Seu player.</span></h1><p>Conecte sua lista M3U ou seus acessos IPTV e organize seus canais em um único player web.</p><div className="connection-tabs"><button className={mode === 'm3u' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('m3u'); setUrlError(null) }}><Link size={15} /> M3U</button><button className={mode === 'xtream' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('xtream'); setUrlError(null) }}><Server size={15} /> Acesso IPTV</button></div>{mode === 'm3u' ? <><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onImportFile(file); e.target.value = '' }} /><div className="url-import"><div className="url-label"><Link size={15} /> Ou importar por URL</div><div className="url-row"><input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="http://servidor/playlist.m3u" /><button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button></div></div></> : <div className="xtream-form"><label>Servidor IPTV<input value={server} onChange={(e) => { setServer(e.target.value); setUrlError(null) }} placeholder="http://servidor:porta" /></label><label>Usuário<input value={username} onChange={(e) => { setUsername(e.target.value); setUrlError(null) }} placeholder="Seu usuário" autoComplete="username" /></label><label>Senha<div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setUrlError(null) }} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><button className="primary-button" disabled={urlLoading} onClick={() => void connectXtream()}>{urlLoading ? <LoaderCircle className="spin" size={18} /> : <Server size={18} />} {urlLoading ? 'Conectando...' : 'Conectar IPTV'}</button></div>}{urlError && <div className="url-error">{urlError}</div>}<div className="privacy-note">A conexão é feita sob demanda. Os dados não são enviados para um banco do StreamHub.</div></section></main>
}
